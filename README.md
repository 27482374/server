# Server Center

A lightweight Windows server administration dashboard inspired by the workflow of Windows Admin Center.

## Features

- Live host information: hostname, OS, architecture, CPU, RAM and uptime
- Disk usage
- Running Windows services
- Top processes
- Service restart action
- Process termination action
- Dark administration sidebar and responsive dashboard
- Local authentication token for administrative actions
- Automatic refresh every 10 seconds

## Run

Requirements: Node.js 18+ on Windows.

```powershell
npm install
$env:ADMIN_TOKEN="change-this-token"
npm start
```

Open **http://127.0.0.1:3000**.

The dashboard intentionally binds to localhost by default. Do not expose administrative endpoints directly to the public internet without adding proper authentication, TLS, authorization and network controls.

## Architecture

`server.js` is the local agent/API. It reads Windows data through PowerShell/CIM and serves the web interface from `public/`.

This is a demonstration/admin utility, not a drop-in replacement for Microsoft's Windows Admin Center.