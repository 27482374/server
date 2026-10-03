const express = require("express");
const os = require("os");
const fs = require("fs");
const { execFile } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "demo-local-only";

app.use(express.json());
app.use(express.static("public"));

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout.trim())
    );
  });
}

function bytesToGB(bytes) {
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}

async function getDisks() {
  if (process.platform !== "win32") return [];
  const raw = await runPowerShell(
    "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | " +
    "Select-Object DeviceID,Size,FreeSpace,VolumeName | ConvertTo-Json -Compress"
  );
  if (!raw) return [];
  const data = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [JSON.parse(raw)];
  return data.map(d => ({
    name: d.DeviceID,
    volume: d.VolumeName || "Local Disk",
    totalGB: bytesToGB(Number(d.Size || 0)),
    freeGB: bytesToGB(Number(d.FreeSpace || 0)),
    usedPercent: d.Size ? Math.round((1 - Number(d.FreeSpace) / Number(d.Size)) * 100) : 0
  }));
}

async function getServices() {
  if (process.platform !== "win32") return [];
  const raw = await runPowerShell(
    "Get-Service | Where-Object {$_.Status -eq 'Running'} | " +
    "Sort-Object DisplayName | Select-Object -First 80 Name,DisplayName,Status,StartType | ConvertTo-Json -Compress"
  );
  if (!raw) return [];
  const data = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [JSON.parse(raw)];
  return data.map(s => ({ name:s.Name, displayName:s.DisplayName, status:s.Status, startType:s.StartType }));
}

async function getProcesses() {
  if (process.platform !== "win32") return [];
  const raw = await runPowerShell(
    "Get-Process | Sort-Object CPU -Descending | Select-Object -First 30 " +
    "Id,ProcessName,@{N='CPU';E={[math]::Round($_.CPU,1)}},WorkingSet64 | ConvertTo-Json -Compress"
  );
  if (!raw) return [];
  const data = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [JSON.parse(raw)];
  return data.map(p => ({
    pid:p.Id, name:p.ProcessName, cpu:p.CPU || 0,
    memoryMB:Math.round(Number(p.WorkingSet64 || 0) / 1024 / 1024)
  }));
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error:"Unauthorized" });
  next();
}

app.get("/api/health", (req,res) => res.json({ ok:true, platform:process.platform, uptime:os.uptime() }));

app.get("/api/system", async (req,res) => {
  try {
    const total = os.totalmem(), free = os.freemem();
    const cpus = os.cpus();
    const [disks, services, processes] = await Promise.all([
      getDisks().catch(() => []),
      getServices().catch(() => []),
      getProcesses().catch(() => [])
    ]);
    res.json({
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      uptime: os.uptime(),
      cpu: { model: cpus[0]?.model || "Unknown", cores: cpus.length, load: os.loadavg()[0] || 0 },
      memory: { totalGB:bytesToGB(total), usedGB:bytesToGB(total-free), freeGB:bytesToGB(free), usedPercent:Math.round((1-free/total)*100) },
      disks, services, processes,
      node: process.version,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error:error.message });
  }
});

app.post("/api/service/:action", auth, async (req,res) => {
  if (process.platform !== "win32") return res.status(400).json({error:"Windows only"});
  const allowed = ["start","stop","restart"];
  if (!allowed.includes(req.params.action)) return res.status(400).json({error:"Invalid action"});
  const name = String(req.body?.name || "").replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!name) return res.status(400).json({error:"Service name required"});
  try {
    const command = req.params.action === "restart"
      ? `Restart-Service -Name '${name}' -Force`
      : `${req.params.action === "start" ? "Start" : "Stop"}-Service -Name '${name}'`;
    await runPowerShell(command);
    res.json({ok:true, action:req.params.action, name});
  } catch (error) {
    res.status(500).json({error:error.message});
  }
});

app.post("/api/process/kill", auth, async (req,res) => {
  if (process.platform !== "win32") return res.status(400).json({error:"Windows only"});
  const pid = Number(req.body?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return res.status(400).json({error:"Invalid PID"});
  try {
    await runPowerShell(`Stop-Process -Id ${pid} -Force`);
    res.json({ok:true, pid});
  } catch (error) {
    res.status(500).json({error:error.message});
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server Center running at http://${HOST}:${PORT}`);
  console.log(`Admin token: ${ADMIN_TOKEN}`);
});