const express = require("express");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "panel.json");
fs.mkdirSync(dataDir, { recursive: true });

const initialData = {
  servers: [
    { id: "srv-main", name: "Main Server", type: "Node.js", status: "online", port: 3000, ram: 4096, cpu: 2, storage: 20, domain: "localhost", createdAt: new Date().toISOString() },
    { id: "srv-demo", name: "Portfolio", type: "Static", status: "stopped", port: 3001, ram: 1024, cpu: 1, storage: 10, domain: "portfolio.local", createdAt: new Date().toISOString() }
  ],
  websites: [
    { id: "web-main", name: "Server Center", domain: "localhost", serverId: "srv-main", status: "online", type: "Node.js", createdAt: new Date().toISOString() },
    { id: "web-portfolio", name: "Portfolio", domain: "portfolio.local", serverId: "srv-demo", status: "offline", type: "Static", createdAt: new Date().toISOString() }
  ],
  databases: [
    { id: "db-001", name: "server_center", engine: "SQLite", size: "1.2 MB", status: "ready" }
  ],
  activity: [
    { message: "Server Center initialized", type: "system", at: new Date().toISOString() }
  ]
};

function loadData() {
  try {
    if (!fs.existsSync(dataFile)) {
      fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2));
      return structuredClone(initialData);
    }
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch {
    return structuredClone(initialData);
  }
}
let data = loadData();

function save() {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

function log(message, type = "system") {
  data.activity.unshift({ message, type, at: new Date().toISOString() });
  data.activity = data.activity.slice(0, 80);
  save();
}

function id(prefix) {
  return prefix + "-" + Math.random().toString(36).slice(2, 9);
}

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout.trim())
    );
  });
}

function bytesToGB(bytes) {
  return Math.round((Number(bytes || 0) / 1024 ** 3) * 10) / 10;
}

async function systemInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  let cpu = 0;

  if (process.platform === "win32") {
    try {
      const raw = await runPowerShell("(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average");
      cpu = Math.round(Number(raw) || 0);
    } catch {}
  }

  let disks = [];
  if (process.platform === "win32") {
    try {
      const raw = await runPowerShell(
        "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace,VolumeName | ConvertTo-Json -Compress"
      );
      if (raw) {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        disks = list.map(d => ({
          name: d.DeviceID,
          volume: d.VolumeName || "Local Disk",
          totalGB: bytesToGB(d.Size),
          freeGB: bytesToGB(d.FreeSpace),
          usedPercent: d.Size ? Math.round((1 - Number(d.FreeSpace) / Number(d.Size)) * 100) : 0
        }));
      }
    } catch {}
  }

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu,
    cores: os.cpus().length,
    memory: {
      totalGB: bytesToGB(total),
      usedGB: bytesToGB(total - free),
      usedPercent: Math.round((1 - free / total) * 100)
    },
    disks,
    uptime: os.uptime(),
    node: process.version
  };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/dashboard", async (req, res) => {
  res.json({
    system: await systemInfo(),
    servers: data.servers,
    websites: data.websites,
    databases: data.databases,
    activity: data.activity
  });
});

app.post("/api/servers", (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Server name is required." });

  const server = {
    id: id("srv"),
    name: name.slice(0, 40),
    type: ["Node.js", "Static", "PHP", "Python"].includes(body.type) ? body.type : "Node.js",
    status: "stopped",
    port: Math.max(1024, Number(body.port) || 3001),
    ram: Math.max(256, Number(body.ram) || 1024),
    cpu: Math.max(1, Number(body.cpu) || 1),
    storage: Math.max(1, Number(body.storage) || 10),
    domain: String(body.domain || "local.test").trim().slice(0, 80),
    createdAt: new Date().toISOString()
  };

  data.servers.push(server);
  log(`Created server "${server.name}" on port ${server.port}`, "server");
  res.status(201).json(server);
});

app.post("/api/servers/:id/action", (req, res) => {
  const server = data.servers.find(s => s.id === req.params.id);
  if (!server) return res.status(404).json({ error: "Server not found." });

  const action = req.body?.action;
  if (action === "start") server.status = "online";
  else if (action === "stop") server.status = "stopped";
  else if (action === "restart") server.status = "online";
  else return res.status(400).json({ error: "Invalid action." });

  log(`${action[0].toUpperCase() + action.slice(1)}ed "${server.name}"`, "server");

  data.websites.filter(w => w.serverId === server.id).forEach(w => {
    w.status = server.status === "online" ? "online" : "offline";
  });

  save();
  res.json(server);
});

app.delete("/api/servers/:id", (req, res) => {
  const index = data.servers.findIndex(s => s.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Server not found." });
  const [removed] = data.servers.splice(index, 1);
  data.websites = data.websites.filter(w => w.serverId !== removed.id);
  log(`Deleted server "${removed.name}"`, "server");
  res.json({ ok: true });
});

app.post("/api/websites", (req, res) => {
  const name = String(req.body?.name || "").trim();
  const domain = String(req.body?.domain || "").trim();
  const serverId = String(req.body?.serverId || "");
  const server = data.servers.find(s => s.id === serverId);

  if (!name || !domain || !server) return res.status(400).json({ error: "Name, domain and server are required." });

  const website = {
    id: id("web"),
    name: name.slice(0, 40),
    domain: domain.slice(0, 100),
    serverId,
    status: server.status === "online" ? "online" : "offline",
    type: server.type,
    createdAt: new Date().toISOString()
  };

  data.websites.push(website);
  log(`Deployed website "${website.domain}" to "${server.name}"`, "website");
  res.status(201).json(website);
});

app.delete("/api/websites/:id", (req, res) => {
  const index = data.websites.findIndex(w => w.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Website not found." });
  const [removed] = data.websites.splice(index, 1);
  log(`Removed website "${removed.domain}"`, "website");
  res.json({ ok: true });
});

app.post("/api/databases", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Database name is required." });
  const db = { id: id("db"), name: name.slice(0, 40), engine: req.body?.engine || "SQLite", size: "0 KB", status: "ready" };
  data.databases.push(db);
  log(`Created database "${db.name}"`, "database");
  res.status(201).json(db);
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, HOST, () => {
  console.log(`Server Center running at http://${HOST}:${PORT}`);
});