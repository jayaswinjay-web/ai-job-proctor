# Runbook — AI Job Proctor voice-agent platform

One-command local start:
    cd /infra
    docker compose up -d                       # self-hosted LiveKit + redis + postgres (5433)
    cd ../agent
    pip install -r requirements.txt            # requires Python <3.14 for agents 1.x plugins
    LIVEKIT_URL=ws://localhost:7880 python -m src.main dev   # register agent worker
    open client/web/index.html                 # web client, enable mic

One-command kiosk start (existing TS stack):
    scripts/start-all.cmd                      # API:4000, kiosk:5173, admin:5174, camera:8090, agent

Health checks:
    Test-NetConnection -ComputerName localhost -Port 7880   # LiveKit signal
    Test-NetConnection -ComputerName localhost -Port 4000   # API
    Test-NetConnection -ComputerName localhost -Port 5173   # kiosk
    docker ps | findstr livekit

Logs:
    agent-test.log / agent-test.err.log        # agent worker
    api.log / kiosk.log / admin.log / face.log / agent.log  # TS stack

Known fragility:
    Docker Desktop drops between turns; restart the stack if ports stop answering.
    The kiosk face gate keeps the AI silent until a face is detected.
