<div align="center">

# H.E.L.I.O.S
### Health Evaluation Logistic Intelligent Onboard System

**NASA Space Apps Challenge 2026**

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat)](LICENSE)

*An offline-first astronaut health-monitoring and decision-support prototype for deep-space missions.*

</div>

## Overview

H.E.L.I.O.S. is a real-time health-monitoring HUD for a simulated four-person deep-space crew. It replays NASA OSDR-derived physiological telemetry at 10 Hz, evaluates each packet against personal baselines, and presents vitals, ECG/PPG waveforms, alerts, triage information, and voice advisories in a browser interface.

The project is designed for communication-blackout scenarios such as a Mars transit. Its core telemetry processing and fallback alert logic run locally. Optional voice features may use Ollama locally; Microsoft Edge Neural TTS and Gemini integrations require network access unless a local fallback is used.

> **Important:** This is a demonstration and research prototype, not a certified medical device or flight-qualified clinical system. Its alerts and calculated risk indices must not be used for real medical or mission decisions.

## Main capabilities

- **First-Person Astronaut Helmet Visor Suit HUD (`/suit-hud`)**:
  - Optical helmet visor simulation with curvature, edge vignette, glare, and dynamic scenario frost/fog/smoke FX.
  - Multi-scene planetary backdrop engine: Mars Surface, Lunar Surface, and real NASA International Space Station (ISS) exterior spacewalk.
  - First-person head-tracking parallax responding to user pointer motion.
  - Role-specific astronaut perspectives (Commander, Pilot, Medical Specialist, Systems Engineer) with tailored pan/tilt/zoom and gyro ladder pitch/roll rungs.
  - Scene- and crew-aware tactical waypoint lock navigation system targeting station modules and planetary habitats with meter-accurate distance and bearing.
  - Laser-etched chin console flight unit identity badges (`NASA xEMU · S/N 4081–4084`).
  - Dual-line non-overlapping Life Support (ECLSS) MFD avionics layout completely eliminating text collisions.
  - Authentic military avionics typography (`'Rajdhani'`, `'Tomorrow'`, monospace) strictly isolated to the HUD visor.
  - Real-time continuous 10 Hz telemetry synchronization, live Mission Elapsed Time (MET) counter, and physiological respiratory sinus arrhythmia (RSA) sinus ticker.
- **Dedicated Earth Mission Control Center (MCC) Console (`/mcc`, `/mcc/telemetry/:name`)**:
  - Deep-space speed-of-light propagation delay countdown ticker (Mars transit: 4 to 24 min one-way) with instant warp-signal bypass.
  - Dedicated JSC Flight Surgeon workstation with live crew telemetry, laboratory panels, and historical trends.
- **Dedicated 3D Holographic Anatomical Body Scanner (`/scanner`)**:
  - Interactive 3D WebGL wireframe rotating mannequin with cyan, amber, and thermal stress modes.
- **Live Spacecraft Cockpit HUD (`/`)**:
  - 10 Hz real-time sensor stream with decoupled 60–90 FPS Lead II ECG and SpO₂ Plethysmograph waveforms.
  - Universal enterprise capsule navigation bar with live telemetry pills and voice toggle.
- **NASA OSDR Laboratory Assays & Computational Biomarkers**:
  - 149 multimodal biomarkers across 10 clinical categories from NASA OSDR Inspiration4 (SOMA).
  - Mathematical risk indices: Early Sepsis (EPI), Arrhythmogenic Risk (ARF), Thrombosis (TRM), and Radiation Sickness (RSI).
- **Hardened Aerospace Security Architecture (OWASP A+ / NASA Class B)**:
  - Canonical path traversal prevention (`SEC-02`), automated security headers middleware (`SEC-06`), and PBKDF2-HMAC-SHA256 authentication.

## Architecture

```text
React 19 + TypeScript + Vite Frontend
  ├── /                Spacecraft Flight HUD (Lead II ECG & Pleth waveforms at 90 FPS)
  ├── /suit-hud        First-Person Astronaut Helmet Visor EVA HUD (Parallax, ISS/Moon/Mars)
  ├── /mcc             Earth Mission Control Ground Station (Deep-Space Latency & Telemetry)
  ├── /scanner         3D Holographic Anatomical Body Scanner (WebGL Wireframe Mannequin)
  └── /telemetry/:slug Individual Clinical Crew Dossier & 119 NASA OSDR Lab Assays
        │
        │ REST /api/* and WebSocket /ws/telemetry (10 Hz)
        ▼
FastAPI Aerospace Backend
  ├── TelemetryFeeder       Replays physiological packets at 10 Hz
  ├── SentryMatrixEngine    Evaluates personal zero-g baselines, z-scores, and severity
  ├── BaselineManager       Maintains crew circadian profiles and resting thresholds
  ├── Decision/Voice Engine Generates clinical voice advisories (Deterministic fallback + Ollama)
  ├── Security Middleware   Enforces X-Frame-Options, X-Content-Type-Options, CSP, and LFI bounds
  └── SQLite WAL Engine     High-throughput local logging (>168,000 writes/sec)
```

## Repository structure

```text
backend/
  app/
    main.py                 FastAPI application, REST routes, WebSocket endpoint
    ai/                     Ollama, decision, fallback, and voice services
    core/                   Biomarkers, baselines, z-scores, and anomaly logic
    db/                     SQLite database and telemetry repositories
    streaming/              10 Hz feeder and WebSocket broadcasting
  tests/                    Backend unit and API tests

frontend/
  src/
    App.tsx                 Main HUD state and telemetry subscriptions
    components/             Crew grid, ECG, triage, JARVIS, and scenario UI
    services/               WebSocket, audio, and routing services
    types/                  TypeScript telemetry definitions
    utils/                  Clinical prioritization and display helpers

data/                       Telemetry stream, baselines, and NASA OSDR data
scripts/                    Data-generation, download, reporting, and test tools
documentation/              Engineering, architecture, and dataset documentation
Demo/                       Demonstration material
render.yaml                 Render deployment configuration
requirements.txt            Python backend dependencies
```

## Setup

### Prerequisites

- Python 3.11 or newer
- Node.js 18 or newer
- Git
- Ollama, only if local AI voice features are required

### 1. Clone the repository

```bash
git clone https://github.com/zihaduzzamaan/H.E.L.I.O.S.git
cd H.E.L.I.O.S
```

### 2. Install backend dependencies

```bash
python -m venv .venv

# macOS/Linux
source .venv/bin/activate

# Windows
.venv\Scripts\activate

pip install -r requirements.txt
```

If the backend reports that `dotenv` is missing, install the package used by the application:

```bash
pip install python-dotenv
```

### 3. Start the backend

Run this command from the repository root:

```bash
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

The API is available at `http://localhost:8000` and interactive documentation is available at `http://localhost:8000/docs`.

### 4. Start the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. Vite proxies `/api/*` and `/ws/*` to the backend at port 8000.

### 5. Optional: enable local JARVIS AI

```bash
ollama pull llama3.2:1b
ollama create helios-jarvis -f backend/app/ai/Modelfile
ollama serve
```

Ollama is optional for the core telemetry dashboard. The repository includes deterministic/fallback alert behavior for environments where the local model is unavailable. Edge TTS and Gemini features are network-dependent and should not be described as fully offline.

## Quick commands

```bash
# Backend
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend
cd frontend && npm run dev

# Frontend production build
cd frontend && npm run build

# Run the project test orchestrator from the repository root
python scripts/run_all_tests.py
```

For the backend API tests that verify serving the compiled frontend, build the frontend first with `npm run build`.

## API reference

### REST endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Basic service and crew status |
| `GET` | `/api/ai/status` | Local AI and voice subsystem status |
| `POST` | `/api/ai/initiate` | Warm up the local Ollama model |
| `GET` | `/api/baselines` | Crew and environmental baselines |
| `GET` | `/api/telemetry/latest-all` | Latest packet for every crew member |
| `GET` | `/api/telemetry/recent/{astronaut_id}` | Recent stored telemetry records |
| `GET` | `/api/telemetry/lab-assays/{astronaut_id}` | Laboratory profile for one astronaut |
| `GET` | `/api/telemetry/lab-assays` | Laboratory profiles for all crew |
| `GET` | `/api/alerts` | Recent proactive alerts |
| `POST` | `/api/scenario/{scenario_key}` | Trigger a named demonstration scenario |
| `POST` | `/api/mars-delay?enabled=true` | Enable or disable Mars-delay simulation |
| `POST` | `/api/voice/query` | Ask JARVIS a text voice query |
| `GET` | `/api/voice/synthesize` | Stream synthesized speech |
| `POST` | `/api/ai/triage/{astronaut_id}` | Generate an on-demand triage record |
| `POST` | `/api/ai/joint-triage` | Generate a joint two-crew advisory |

### WebSocket

```text
ws://localhost:8000/ws/telemetry
```

The backend broadcasts telemetry packets at approximately 10 Hz and sends alert packets when severity changes or a proactive advisory is generated.

## Telemetry and alert pipeline

```text
data/astronaut_telemetry_stream.csv
        |
        v
TelemetryFeeder.step_tick()
        |
        v
SentryMatrixEngine.evaluate_state()
  ├── personal-baseline z-scores
  ├── activity/workout gating
  ├── EPI: early sepsis index
  ├── ARF: arrhythmogenic risk
  ├── TRM: thrombosis risk
  └── RSI: radiation sickness index
        |
        v
SQLite logging + WebSocket broadcast + optional JARVIS advisory
```

The scenario controller can modify selected telemetry values to demonstrate conditions such as hypoxia, CO₂ scrubber failure, radiation storms, hypokalemia, thrombosis risk, sepsis, and circadian fatigue.

## Data sources

The included data is derived from NASA Open Science Data Repository studies, including:

- **OSD-569:** Inspiration4 complete blood-count data
- **OSD-575:** cardiovascular, metabolic, and immune panels from the SOMA Human Spaceflight Atlas

See [`documentation/dataset_coverage_analysis.md`](documentation/dataset_coverage_analysis.md) for the field-by-field coverage review.

## Deployment

`render.yaml` contains a production-ready Render Blueprint. If configuring manually in the Render Dashboard:

- **Environment**: `Python`
- **Build Command**:
  ```bash
  npm install && npm install @rolldown/binding-linux-x64-gnu@1.2.15 lightningcss-linux-x64-gnu@1.33.0 --no-save && (cd frontend && npm install @rolldown/binding-linux-x64-gnu@1.2.15 lightningcss-linux-x64-gnu@1.33.0 --no-save) && npm run build && pip install -r requirements.txt
  ```
- **Start Command**:
  ```bash
  uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT
  ```
- **Environment Variables**:
  - `NODE_VERSION`: `22`
  - `PYTHON_VERSION`: `3.11.9`
  - `DETERMINISTIC_FALLBACK_ACTIVE`: `true`

## Known limitations

- This repository replays and simulates telemetry; it is not connected to live astronaut sensors.
- The risk indices are project algorithms and have not been validated for clinical or flight use.
- Telemetry is primarily stored in memory during replay, with SQLite used for logging and queries.
- Ollama requires local compute and model storage.
- Microsoft Edge TTS and Gemini integrations require network access.
- The system should display stale-data status and service degradation clearly before being considered operationally reliable.

## Documentation

- [`security.md`](security.md) — Security Audit & Red Team Assessment (OWASP Top 10 / NASA Flight Safety Class B)
- [`documentation/PROJECT_MASTER_DOCUMENTATION.md`](documentation/PROJECT_MASTER_DOCUMENTATION.md) — Project Master Architecture & Specifications
- [`documentation/Astronaut_Health_JARVIS_System_Documentation.md`](documentation/Astronaut_Health_JARVIS_System_Documentation.md) — JARVIS AI Clinical System Guide
- [`documentation/NASA_Flight_Software_Architecture_Standard.md`](documentation/NASA_Flight_Software_Architecture_Standard.md) — Flight Software Standards & Compliance
- [`documentation/dataset_coverage_analysis.md`](documentation/dataset_coverage_analysis.md) — NASA OSDR Inspiration4 Dataset Coverage Audit

## License

MIT License. See [`LICENSE`](LICENSE).
