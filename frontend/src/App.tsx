import { useEffect, useState, useRef, useCallback } from 'react';
import { HeaderBar } from './components/HeaderBar';
import { ScenarioController } from './components/ScenarioController';
import { HealthTelemetryView } from './components/HealthTelemetryView';
import { MissionControlView } from './components/MissionControlView';
import { HolographicBodyScanner } from './components/HolographicBodyScanner';
import { SpaceBackground } from './components/SpaceBackground';
import { MainIndexDeck } from './components/MainIndexDeck';
import { SuitHudView } from './components/suit-hud/SuitHudView';
import { wsService } from './services/websocketService';
import { audioService } from './services/audioService';
import {
  parseCurrentRoute,
  navigateTo,
  getSlugFromAstronautId,
} from './services/routerService';
import type { TelemetryPacket, AlertPayload, DistancePreset } from './types/telemetry';
import { DISTANCES, fmtTime } from './types/telemetry';
import {
  DEFAULT_NOMINAL_TELEMETRY,
  generateScenarioTelemetry,
  generateScenarioAlert,
  tickOfflineTelemetry,
} from './utils/scenarioSimulator';

export function App() {
  // Parse initial route: '/' -> HUD; '/telemetry/:name' -> Health Telemetry; '/mcc' -> Earth MCC; '/mcc/telemetry/:name' -> Earth MCC Telemetry; '/scanner' -> 3D Hologram
  const initialRoute = parseCurrentRoute();
  const [activeView, setActiveView] = useState<'HUD' | 'HEALTH_TELEMETRY' | 'MCC' | 'SCANNER' | 'MCC_TELEMETRY' | 'SUIT_HUD'>(initialRoute.view);
  const [activeTriageAstronautId, setActiveTriageAstronautId] = useState<string | null>(
    initialRoute.view === 'HEALTH_TELEMETRY' ? initialRoute.astronautId : null
  );
  const [activeMccAstronautId, setActiveMccAstronautId] = useState<string | null>(
    initialRoute.view === 'MCC_TELEMETRY' ? initialRoute.astronautId : null
  );
  const [scannerAstronautId, setScannerAstronautId] = useState<string>('AST-02_PILOT');

  const [connected, setConnected] = useState<boolean>(false);
  const connectedRef = useRef<boolean>(false);
  const [marsDelay, setMarsDelay] = useState<boolean>(false);
  const [orbitalPosition, setOrbitalPosition] = useState<DistancePreset>('LEO');
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1);
  const [targetAstronautId, setTargetAstronautId] = useState<string | null>('AST-01_COMMANDER');
  const targetAstronautIdRef = useRef<string | null>('AST-01_COMMANDER');

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  // ─── 1. SPACECRAFT ONBOARD TELEMETRY STATE (INSTANT, LOCAL 10 HZ, ZERO DELAY) ───
  const [telemetryMap, setTelemetryMap] = useState<Record<string, TelemetryPacket>>(
    () => JSON.parse(JSON.stringify(DEFAULT_NOMINAL_TELEMETRY))
  );
  const [latestAlert, setLatestAlert] = useState<AlertPayload | null>(null);
  const [currentScenario, setCurrentScenario] = useState<string>('NOMINAL_CRUISE');
  const [scannerTheme, setScannerTheme] = useState<'CYAN' | 'THERMAL' | 'AMBER'>('CYAN');
  const [showEclssBar, setShowEclssBar] = useState<boolean>(true);
  const bufferedPacketsRef = useRef<Record<string, TelemetryPacket>>(
    JSON.parse(JSON.stringify(DEFAULT_NOMINAL_TELEMETRY))
  );

  // ─── 2. EARTH MISSION CONTROL TELEMETRY STATE (SUBJECT TO LIGHT PROPAGATION DELAY) ───
  const [mccTelemetryMap, setMccTelemetryMap] = useState<Record<string, TelemetryPacket>>(
    () => JSON.parse(JSON.stringify(DEFAULT_NOMINAL_TELEMETRY))
  );
  const [mccAlert, setMccAlert] = useState<AlertPayload | null>(null);
  const [mccScenario, setMccScenario] = useState<string>('NOMINAL_CRUISE');
  const bufferedMccPacketsRef = useRef<Record<string, TelemetryPacket>>(
    JSON.parse(JSON.stringify(DEFAULT_NOMINAL_TELEMETRY))
  );

  // Deep-Space In-Transit Signal Tracking for Earth Ground Station
  const [inTransitSignal, setInTransitSignal] = useState<{
    scenarioKey: string;
    telemetry?: Record<string, any>;
    originPosition: DistancePreset;
    delaySec: number;
    remainingSec: number;
    startTime: number;
  } | null>(null);

  const inTransitSignalRef = useRef<typeof inTransitSignal>(null);
  const inTransitPacketsRef = useRef<Record<string, TelemetryPacket>>({});
  const inTransitAlertRef = useRef<AlertPayload | null>(null);
  const mccScenarioRef = useRef<string>(mccScenario);
  const orbitalPositionRef = useRef<DistancePreset>(orbitalPosition);
  const marsDelayRef = useRef<boolean>(marsDelay);
  const mccBaselineSnapshotRef = useRef<Record<string, TelemetryPacket>>(
    JSON.parse(JSON.stringify(DEFAULT_NOMINAL_TELEMETRY))
  );

  useEffect(() => {
    inTransitSignalRef.current = inTransitSignal;
  }, [inTransitSignal]);

  useEffect(() => {
    mccScenarioRef.current = mccScenario;
  }, [mccScenario]);

  useEffect(() => {
    orbitalPositionRef.current = orbitalPosition;
  }, [orbitalPosition]);

  useEffect(() => {
    marsDelayRef.current = marsDelay;
  }, [marsDelay]);

  // Synchronize browser history / URL with application view
  useEffect(() => {
    const handlePopState = () => {
      const route = parseCurrentRoute();
      setActiveView(route.view);
      if (route.view === 'HEALTH_TELEMETRY') {
        setActiveTriageAstronautId(route.astronautId);
        setActiveMccAstronautId(null);
      } else if (route.view === 'MCC_TELEMETRY') {
        setActiveMccAstronautId(route.astronautId);
        setActiveTriageAstronautId(null);
      } else if (route.view === 'SCANNER') {
        setScannerAstronautId(route.astronautId || 'AST-02_PILOT');
        setActiveTriageAstronautId(null);
        setActiveMccAstronautId(null);
      } else if (route.view === 'SUIT_HUD') {
        setActiveTriageAstronautId(null);
        setActiveMccAstronautId(null);
      } else {
        setActiveTriageAstronautId(null);
        setActiveMccAstronautId(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    // 0. Seed initial telemetry data immediately so metrics are never empty on load
    fetch('/api/telemetry/latest-all')
      .then((res) => res.json())
      .then((data) => {
        if (data.telemetry) {
          const onboardData = JSON.parse(JSON.stringify(data.telemetry));
          const mccData = JSON.parse(JSON.stringify(data.telemetry));
          bufferedPacketsRef.current = onboardData;
          bufferedMccPacketsRef.current = mccData;
          mccBaselineSnapshotRef.current = JSON.parse(JSON.stringify(data.telemetry));
          setTelemetryMap(onboardData);
          setMccTelemetryMap(mccData);
          const firstPacket = Object.values(data.telemetry)[0] as TelemetryPacket | undefined;
          if (firstPacket && firstPacket.scenario_phase) {
            setCurrentScenario(firstPacket.scenario_phase);
            setMccScenario(firstPacket.scenario_phase);
            mccScenarioRef.current = firstPacket.scenario_phase;
          }
        }
      })
      .catch(() => {
        // Fallback handled by live WebSocket
      });

    // 1. Connect WebSocket
    wsService.connect();

    // 2. Subscribe to status
    const unsubStatus = wsService.subscribeStatus((isConnected) => {
      setConnected(isConnected);
    });

    // 3. Subscribe to 10 Hz Telemetry
    const unsubTelemetry = wsService.subscribeTelemetry((packet: TelemetryPacket) => {
      // Spacecraft onboard sensors are ALWAYS instant:
      bufferedPacketsRef.current[packet.astronaut_id] = packet;
      if (packet.scenario_phase) {
        setCurrentScenario((prev) => (prev === packet.scenario_phase ? prev : packet.scenario_phase));
      }

      // Deep-space delay check for Earth MCC:
      const delaySec = DISTANCES[orbitalPositionRef.current]?.delaySec ?? 0;
      const isDeepSpaceDelayed = delaySec > 0.05 || marsDelayRef.current;

      if (isDeepSpaceDelayed) {
        // If a scenario transmission is currently in flight OR if incoming packet is from a newer scenario:
        const isPacketInTransit =
          inTransitSignalRef.current !== null ||
          (Boolean(packet.scenario_phase) && packet.scenario_phase !== mccScenarioRef.current);

        if (isPacketInTransit) {
          // Quarantine new scenario packets into in-transit buffer
          inTransitPacketsRef.current[packet.astronaut_id] = packet;

          // Crucial: Earth MCC MUST NOT receive this packet!
          // Maintain the clean pre-scenario baseline packet for Earth MCC:
          if (mccBaselineSnapshotRef.current[packet.astronaut_id]) {
            bufferedMccPacketsRef.current[packet.astronaut_id] = {
              ...mccBaselineSnapshotRef.current[packet.astronaut_id],
            };
          }
          return;
        }
      }

      // Earth MCC receives packets directly when in LEO or matching the active Earth MCC phase:
      bufferedMccPacketsRef.current[packet.astronaut_id] = packet;
      if (packet.scenario_phase && !isDeepSpaceDelayed) {
        setMccScenario((prev) => (prev === packet.scenario_phase ? prev : packet.scenario_phase));
        mccScenarioRef.current = packet.scenario_phase;
      }
    });

    // 10 Hz state ticker (100ms) to update React components smoothly with real sensor data
    let offlineTick = 0;
    const telemetryInterval = setInterval(() => {
      offlineTick++;
      // If offline (WebSocket disconnected), apply subtle physiological micro-ticking
      if (!connectedRef.current && Object.keys(bufferedPacketsRef.current).length > 0) {
        bufferedPacketsRef.current = tickOfflineTelemetry(bufferedPacketsRef.current, offlineTick);
      }
      if (Object.keys(bufferedPacketsRef.current).length > 0) {
        setTelemetryMap({ ...bufferedPacketsRef.current });
      }
      if (Object.keys(bufferedMccPacketsRef.current).length > 0) {
        setMccTelemetryMap({ ...bufferedMccPacketsRef.current });
      }
    }, 100);

    // 4. Subscribe to Proactive AI Surgeon Alerts
    const unsubAlert = wsService.subscribeAlert((alert: AlertPayload) => {
      // Spacecraft onboard alert is always instant:
      setLatestAlert(alert);

      // Deep-space delay check for Earth MCC:
      const delaySec = DISTANCES[orbitalPositionRef.current]?.delaySec ?? 0;
      const isDeepSpaceDelayed = delaySec > 0.05 || marsDelayRef.current;

      if (isDeepSpaceDelayed && (inTransitSignalRef.current !== null || alert.severity !== 'NOMINAL')) {
        inTransitAlertRef.current = alert;
      } else {
        setMccAlert(alert);
      }
    });

    return () => {
      clearInterval(telemetryInterval);
      unsubStatus();
      unsubTelemetry();
      unsubAlert();
      wsService.disconnect();
    };
  }, []);

  const handleOrbitalPositionChange = useCallback((pos: DistancePreset) => {
    setOrbitalPosition(pos);
    orbitalPositionRef.current = pos;
    const isDelayed = pos === 'MARS_MIN' || pos === 'MARS_MAX';
    setMarsDelay(isDelayed);
    marsDelayRef.current = isDelayed;
    fetch(`/api/mars-delay?enabled=${isDelayed}`, { method: 'POST' }).catch(() => {});

    // If switched to non-delayed position (e.g. LEO), immediately warp in-transit signal to Earth MCC:
    if (!isDelayed && inTransitSignalRef.current) {
      applyMccTelemetryUpdate(inTransitSignalRef.current.scenarioKey, inTransitSignalRef.current.telemetry);
    }
  }, []);

  const handleToggleMarsDelay = async (enabled: boolean) => {
    setMarsDelay(enabled);
    marsDelayRef.current = enabled;
    const newPos = enabled ? 'MARS_MAX' : 'LEO';
    setOrbitalPosition(newPos);
    orbitalPositionRef.current = newPos;
    try {
      await fetch(`/api/mars-delay?enabled=${enabled}`, { method: 'POST' });
    } catch {
      // Ignore
    }
    if (!enabled && inTransitSignalRef.current) {
      applyMccTelemetryUpdate(inTransitSignalRef.current.scenarioKey, inTransitSignalRef.current.telemetry);
    }
  };

  // Deliver delayed signal to Earth MCC Ground Station
  const applyMccTelemetryUpdate = useCallback((scenarioKey: string, telemetry?: Record<string, any>) => {
    setMccScenario(scenarioKey);
    mccScenarioRef.current = scenarioKey;

    if (telemetry && Object.keys(telemetry).length > 0) {
      bufferedMccPacketsRef.current = { ...bufferedMccPacketsRef.current, ...JSON.parse(JSON.stringify(telemetry)) };
    }
    if (Object.keys(inTransitPacketsRef.current).length > 0) {
      bufferedMccPacketsRef.current = { ...bufferedMccPacketsRef.current, ...JSON.parse(JSON.stringify(inTransitPacketsRef.current)) };
      inTransitPacketsRef.current = {};
    }
    mccBaselineSnapshotRef.current = JSON.parse(JSON.stringify(bufferedMccPacketsRef.current));
    setMccTelemetryMap({ ...bufferedMccPacketsRef.current });

    if (inTransitAlertRef.current) {
      setMccAlert(inTransitAlertRef.current);
      inTransitAlertRef.current = null;
    }
    inTransitSignalRef.current = null;
    setInTransitSignal(null);
  }, []);

  // Scenario Triggered: Spacecraft onboard responds INSTANTLY; Earth MCC enters in-transit delay
  const handleScenarioTriggered = useCallback(
    (scenarioKey: string, telemetry?: Record<string, any>, targetCrewId?: string | null) => {
      // 1. Spacecraft Onboard: 100% instant update with zero latency
      setCurrentScenario(scenarioKey);
      const effectiveTarget = targetCrewId || targetAstronautIdRef.current || 'AST-01_COMMANDER';
      setTargetAstronautId(effectiveTarget);
      targetAstronautIdRef.current = effectiveTarget;

      // Synthesize realistic scenario telemetry immediately (operates in offline & online)
      const simulated = generateScenarioTelemetry(scenarioKey, effectiveTarget, bufferedPacketsRef.current);
      const effectiveTelemetry = (telemetry && Object.keys(telemetry).length > 0)
        ? { ...simulated, ...JSON.parse(JSON.stringify(telemetry)) }
        : simulated;

      bufferedPacketsRef.current = effectiveTelemetry;
      setTelemetryMap({ ...effectiveTelemetry });

      // Trigger clinical alert immediately
      const alert = generateScenarioAlert(scenarioKey, effectiveTarget);
      if (alert) {
        setLatestAlert(alert);
        if (alert.speech_text && scenarioKey !== 'NOMINAL_CRUISE') {
          audioService.queueSpeech({
            text: alert.speech_text,
            tone: alert.tone,
            config: { severity: alert.severity },
          });
        }
      }

      // 2. Earth MCC: Subject to deep-space radio propagation delay
      const currentPos = orbitalPositionRef.current;
      const delaySec = DISTANCES[currentPos]?.delaySec ?? 0;
      const isDelayed = (delaySec > 0.05 || marsDelayRef.current) && scenarioKey !== 'NOMINAL_CRUISE';

      if (!isDelayed) {
        applyMccTelemetryUpdate(scenarioKey, effectiveTelemetry);
      } else {
        // Capture clean Earth MCC pre-scenario baseline IF no signal is currently in transit:
        if (!inTransitSignalRef.current && Object.keys(bufferedMccPacketsRef.current).length > 0) {
          mccBaselineSnapshotRef.current = JSON.parse(JSON.stringify(bufferedMccPacketsRef.current));
        }

        // Buffer into inTransitPacketsRef (NOT bufferedMccPacketsRef):
        Object.entries(effectiveTelemetry).forEach(([id, pkt]) => {
          inTransitPacketsRef.current[id] = pkt as TelemetryPacket;
        });

        // Explicitly keep Earth MCC locked to the clean baseline!
        if (Object.keys(mccBaselineSnapshotRef.current).length > 0) {
          bufferedMccPacketsRef.current = JSON.parse(JSON.stringify(mccBaselineSnapshotRef.current));
          setMccTelemetryMap({ ...bufferedMccPacketsRef.current });
        }

        const calculatedDelay = delaySec > 0 ? delaySec : 1334.925;
        const newSignal = {
          scenarioKey,
          telemetry: effectiveTelemetry,
          originPosition: currentPos,
          delaySec: calculatedDelay,
          remainingSec: inTransitSignalRef.current?.remainingSec ?? calculatedDelay,
          startTime: inTransitSignalRef.current?.startTime ?? Date.now(),
        };

        // Crucial: Update ref synchronously so any incoming WebSocket frames are held immediately!
        inTransitSignalRef.current = newSignal;
        setInTransitSignal(newSignal);
      }
    },
    [applyMccTelemetryUpdate]
  );

  // Deep-space light propagation countdown ticker (accelerated by speedMultiplier)
  useEffect(() => {
    if (!inTransitSignal) return;

    const timer = setInterval(() => {
      const elapsedRealSec = (Date.now() - inTransitSignal.startTime) / 1000;
      const effectiveElapsed = elapsedRealSec * speedMultiplier;
      const remaining = Math.max(0, inTransitSignal.delaySec - effectiveElapsed);

      if (remaining <= 0) {
        applyMccTelemetryUpdate(inTransitSignal.scenarioKey, inTransitSignal.telemetry);
      } else {
        setInTransitSignal((prev) => (prev ? { ...prev, remainingSec: remaining } : null));
      }
    }, 100);

    return () => clearInterval(timer);
  }, [inTransitSignal, speedMultiplier, applyMccTelemetryUpdate]);

  const handleWarpSignal = useCallback(() => {
    const currentSignal = inTransitSignalRef.current || inTransitSignal;
    if (currentSignal) {
      applyMccTelemetryUpdate(currentSignal.scenarioKey, currentSignal.telemetry);
    }
  }, [inTransitSignal, applyMccTelemetryUpdate]);

  // Navigation Handlers with instant browser URL synchronization
  const handleOpenTriage = useCallback((astId: string) => {
    const slug = getSlugFromAstronautId(astId);
    setActiveTriageAstronautId(astId);
    setActiveView('HEALTH_TELEMETRY');
    navigateTo(`/telemetry/${slug}`);
  }, []);

  const handleCloseTelemetry = useCallback(() => {
    setActiveView('HUD');
    setActiveTriageAstronautId(null);
    navigateTo('/');
  }, []);

  const handleAstronautChange = useCallback((astId: string) => {
    const slug = getSlugFromAstronautId(astId);
    setActiveTriageAstronautId(astId);
    navigateTo(`/telemetry/${slug}`);
  }, []);

  // Earth MCC Dedicated Telemetry Console Navigation
  const handleOpenMccTelemetry = useCallback((astId: string) => {
    const slug = getSlugFromAstronautId(astId);
    setActiveMccAstronautId(astId);
    setActiveView('MCC_TELEMETRY');
    navigateTo(`/mcc/telemetry/${slug}`);
  }, []);

  const handleCloseMccTelemetry = useCallback(() => {
    setActiveView('MCC');
    setActiveMccAstronautId(null);
    navigateTo('/mcc');
  }, []);

  const handleMccAstronautChange = useCallback((astId: string) => {
    const slug = getSlugFromAstronautId(astId);
    setActiveMccAstronautId(astId);
    navigateTo(`/mcc/telemetry/${slug}`);
  }, []);

  const handleSelectView = useCallback(
    (view: 'HUD' | 'HEALTH_TELEMETRY' | 'MCC' | 'SCANNER' | 'MCC_TELEMETRY' | 'SUIT_HUD') => {
      if (view === 'HUD') {
        setActiveView('HUD');
        setActiveTriageAstronautId(null);
        setActiveMccAstronautId(null);
        navigateTo('/');
      } else if (view === 'MCC') {
        setActiveView('MCC');
        setActiveTriageAstronautId(null);
        setActiveMccAstronautId(null);
        navigateTo('/mcc');
      } else if (view === 'MCC_TELEMETRY') {
        const targetId = activeMccAstronautId || 'AST-01_COMMANDER';
        const slug = getSlugFromAstronautId(targetId);
        setActiveView('MCC_TELEMETRY');
        setActiveMccAstronautId(targetId);
        navigateTo(`/mcc/telemetry/${slug}`);
      } else if (view === 'SCANNER') {
        setActiveView('SCANNER');
        setActiveTriageAstronautId(null);
        setActiveMccAstronautId(null);
        navigateTo('/scanner');
      } else if (view === 'SUIT_HUD') {
        setActiveView('SUIT_HUD');
        setActiveTriageAstronautId(null);
        setActiveMccAstronautId(null);
        navigateTo('/suit-hud');
      } else {
        const targetId = activeTriageAstronautId || 'AST-01_COMMANDER';
        const slug = getSlugFromAstronautId(targetId);
        setActiveView('HEALTH_TELEMETRY');
        setActiveTriageAstronautId(targetId);
        navigateTo(`/telemetry/${slug}`);
      }
    },
    [activeTriageAstronautId, activeMccAstronautId]
  );

  // Deep-Space Telemetry Downlink In-Transit Status Ribbon (Strictly rendered within Earth MCC domain)
  const renderInTransitBanner = () => {
    if (!inTransitSignal) return null;
    return (
      <div
        style={{
          background: 'linear-gradient(90deg, rgba(6, 17, 32, 0.98) 0%, rgba(10, 25, 47, 0.98) 100%)',
          borderBottom: '1px solid rgba(56, 189, 248, 0.45)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.85), 0 0 15px rgba(56, 189, 248, 0.2)',
          backdropFilter: 'blur(10px)',
          padding: '6px 20px',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          fontFamily: "var(--hud-font-mono, 'Tomorrow', monospace)",
          width: '100%',
          position: 'relative',
          zIndex: 150,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#38bdf8',
                boxShadow: '0 0 10px #38bdf8',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#38bdf8', letterSpacing: '0.06em' }}>
              DEEP SPACE DOWNLINK IN-TRANSIT
            </span>
          </div>

          <span style={{ color: '#334155' }}>|</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
            <span style={{ color: '#64748b' }}>ORIGIN:</span>
            <span style={{ color: '#f8fafc', fontWeight: 600 }}>{DISTANCES[inTransitSignal.originPosition].label}</span>
            <span style={{ color: '#64748b' }}>({(DISTANCES[inTransitSignal.originPosition].km / 1e6).toFixed(1)}M km)</span>
          </div>

          <span style={{ color: '#334155' }}>|</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
            <span style={{ color: '#64748b' }}>SCENARIO:</span>
            <span style={{ color: '#fbbf24', fontWeight: 700 }}>
              {inTransitSignal.scenarioKey.replace(/^SCENARIO_\d+_/, '').replace(/_/g, ' ')}
            </span>
          </div>

          <span style={{ color: '#334155' }}>|</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
            <span style={{ color: '#64748b' }}>LIGHT TRAVEL REMAINING:</span>
            <span style={{ color: '#4ade80', fontWeight: 800, fontSize: 11 }}>
              {fmtTime(inTransitSignal.remainingSec)}
            </span>
            {speedMultiplier > 1 && (
              <span style={{ color: '#38bdf8', fontSize: 9 }}>({speedMultiplier}x speed)</span>
            )}
          </div>
        </div>

        <button
          onClick={handleWarpSignal}
          title="Accelerate light-speed propagation and instantly deliver the telemetry packet to Earth MCC"
          style={{
            background: 'rgba(56, 189, 248, 0.16)',
            border: '1px solid #38bdf8',
            borderRadius: 4,
            padding: '3px 10px',
            color: '#ffffff',
            fontSize: 9.5,
            fontWeight: 800,
            letterSpacing: '0.04em',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease',
          }}
        >
          <span>WARP SIGNAL TO EARTH (INSTANT RECEPTION)</span>
        </button>
      </div>
    );
  };

  return (
    <>
      {/* GPU-Composited Photorealistic Earth Orbital Space Background */}
      <SpaceBackground activeView={activeView} />

      {/* ─── 1. FLIGHT HUD VIEW (DEFAULT HOME PAGE — 100% INSTANT SPACECRAFT DATA) ─── */}
      {activeView === 'HUD' && (
        <>
          {/* Universal Floating Header Capsule */}
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 200,
              overflow: 'visible',
              width: '100%',
              padding: '12px 20px 0',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
              <HeaderBar
                connected={connected}
                marsDelay={false}
                orbitalPosition={orbitalPosition}
                speedMultiplier={speedMultiplier}
                activeView={activeView}
                onSelectView={handleSelectView}
                latestAlert={latestAlert}
                selectedAstronautId={activeTriageAstronautId || 'AST-01_COMMANDER'}
                scannerTheme={scannerTheme}
                onSelectScannerTheme={setScannerTheme}
                showEclssBar={showEclssBar}
                onToggleEclss={() => setShowEclssBar((prev) => !prev)}
                currentScenario={currentScenario}
                telemetryMap={telemetryMap}
                onOpenTriage={handleOpenTriage}
              />
            </div>
          </div>

          {/* Futuristic 3D Holographic Flight Command Deck */}
          <MainIndexDeck
            telemetryMap={telemetryMap}
            latestAlert={latestAlert}
            currentScenario={currentScenario}
            orbitalPosition={orbitalPosition}
            onOpenTriage={handleOpenTriage}
            onSelectView={handleSelectView}
            scannerTheme={scannerTheme}
            onSelectScannerTheme={setScannerTheme}
            showEclssBar={showEclssBar}
            onToggleEclss={() => setShowEclssBar((prev) => !prev)}
            targetAstronautId={targetAstronautId}
          />
        </>
      )}

      {/* ─── 2. ONBOARD SPACECRAFT HEALTH TELEMETRY & CLINICAL ANALYSIS (INSTANT) ─── */}
      {activeView === 'HEALTH_TELEMETRY' && (
        <>
          {/* Universal Floating Header Capsule */}
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 200,
              overflow: 'visible',
              width: '100%',
              padding: '12px 20px 0',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
              <HeaderBar
                connected={connected}
                marsDelay={false}
                orbitalPosition={orbitalPosition}
                speedMultiplier={speedMultiplier}
                activeView={activeView}
                onSelectView={handleSelectView}
                latestAlert={latestAlert}
                selectedAstronautId={activeTriageAstronautId || 'AST-01_COMMANDER'}
                scannerTheme={scannerTheme}
                onSelectScannerTheme={setScannerTheme}
                showEclssBar={showEclssBar}
                onToggleEclss={() => setShowEclssBar((prev) => !prev)}
                currentScenario={currentScenario}
                telemetryMap={telemetryMap}
                onOpenTriage={handleOpenTriage}
              />
            </div>
          </div>
          <HealthTelemetryView
            hideHeader={true}
            initialAstronautId={activeTriageAstronautId || 'AST-01_COMMANDER'}
            telemetryMap={telemetryMap}
            marsDelay={false}
            connected={connected}
            latestAlert={latestAlert}
            onToggleMarsDelay={handleToggleMarsDelay}
            activeView={activeView}
            onSelectView={handleSelectView}
            onClose={handleCloseTelemetry}
            onAstronautChange={handleAstronautChange}
          />
        </>
      )}

      {/* ─── 3. EARTH MISSION CONTROL CENTER (MCC GROUND CONSOLE — DELAYED TELEMETRY) ─── */}
      {activeView === 'MCC' && (
        <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', backgroundColor: 'transparent' }}>
          {/* Top Sticky Header */}
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 200,
              overflow: 'visible',
              width: '100%',
              padding: '12px 20px 0',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
              <HeaderBar
                connected={connected}
                marsDelay={marsDelay}
                onToggleMarsDelay={handleToggleMarsDelay}
                orbitalPosition={orbitalPosition}
                onSelectOrbitalPosition={handleOrbitalPositionChange}
                speedMultiplier={speedMultiplier}
                activeView={activeView}
                onSelectView={handleSelectView}
                latestAlert={mccAlert}
                selectedAstronautId={activeTriageAstronautId || 'AST-01_COMMANDER'}
                scannerTheme={scannerTheme}
                onSelectScannerTheme={setScannerTheme}
                showEclssBar={showEclssBar}
                onToggleEclss={() => setShowEclssBar((prev) => !prev)}
                currentScenario={mccScenario}
                telemetryMap={mccTelemetryMap}
                onOpenTriage={handleOpenMccTelemetry}
              />
            </div>
            {/* Deep-Space Downlink In-Transit Status Ribbon (shown only on Earth MCC views) */}
            {renderInTransitBanner()}
          </div>

          <MissionControlView
            telemetryMap={mccTelemetryMap}
            latestAlert={mccAlert}
            connected={connected}
            marsDelay={marsDelay}
            onToggleMarsDelay={handleToggleMarsDelay}
            orbitalPosition={orbitalPosition}
            onSelectOrbitalPosition={handleOrbitalPositionChange}
            speedMultiplier={speedMultiplier}
            onSpeedMultiplierChange={setSpeedMultiplier}
            onSelectView={handleSelectView}
            currentScenario={mccScenario}
            onOpenTriage={handleOpenMccTelemetry}
            onOpenMccTelemetry={handleOpenMccTelemetry}
          />
        </div>
      )}

      {/* ─── 4. DEDICATED EARTH MCC BIOMEDICAL TELEMETRY CONSOLE (/mcc/telemetry/:name) ─── */}
      {activeView === 'MCC_TELEMETRY' && (
        <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', backgroundColor: 'transparent' }}>
          {/* Top Sticky Header for Earth Ground Station */}
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 200,
              overflow: 'visible',
              width: '100%',
              padding: '12px 20px 0',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
              <HeaderBar
                connected={connected}
                marsDelay={marsDelay}
                onToggleMarsDelay={handleToggleMarsDelay}
                orbitalPosition={orbitalPosition}
                onSelectOrbitalPosition={handleOrbitalPositionChange}
                speedMultiplier={speedMultiplier}
                activeView={activeView}
                onSelectView={handleSelectView}
                latestAlert={mccAlert}
                selectedAstronautId={activeMccAstronautId || 'AST-01_COMMANDER'}
                scannerTheme={scannerTheme}
                onSelectScannerTheme={setScannerTheme}
                showEclssBar={showEclssBar}
                onToggleEclss={() => setShowEclssBar((prev) => !prev)}
                currentScenario={mccScenario}
                telemetryMap={mccTelemetryMap}
                onOpenTriage={handleOpenMccTelemetry}
              />
            </div>

            {/* Earth Ground Station Operational Breadcrumb Bar */}
            <div
              style={{
                background: 'linear-gradient(90deg, #0b1117 0%, #080d12 100%)',
                borderBottom: '1px solid rgba(56, 189, 248, 0.25)',
                padding: '7px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontFamily: "var(--hud-font-mono, 'Tomorrow', monospace)",
                fontSize: '11px',
                color: '#94a3b8',
                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.5)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={handleCloseMccTelemetry}
                  style={{
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    borderRadius: 4,
                    padding: '3px 10px',
                    color: '#38bdf8',
                    fontSize: '10px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: "var(--hud-font-sans, 'Tomorrow', sans-serif)",
                    letterSpacing: '0.04em',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(56, 189, 248, 0.25)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)';
                  }}
                >
                  <span>← RETURN TO MCC MAIN CONSOLE</span>
                </button>

                <span style={{ color: '#334155' }}>|</span>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: '#38bdf8',
                      boxShadow: '0 0 8px #38bdf8',
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ color: '#f8fafc', fontWeight: 800, letterSpacing: '0.06em' }}>
                    EARTH MCC // CLINICAL TELEMETRY CONSOLE
                  </span>
                  <span style={{ color: '#64748b' }}>(JSC FLIGHT SURGEON WORKSTATION)</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '10.5px' }}>
                  <span style={{ color: '#64748b' }}>DOWNLINK:</span>
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>
                    DSN KA-BAND ({DISTANCES[orbitalPosition]?.label})
                  </span>
                </div>

                <span style={{ color: '#334155' }}>|</span>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '10.5px' }}>
                  <span style={{ color: '#64748b' }}>PROPAGATION LATENCY:</span>
                  <span style={{ color: '#fbbf24', fontWeight: 800 }}>
                    +{fmtTime(DISTANCES[orbitalPosition]?.delaySec ?? 0)} ONE-WAY
                  </span>
                </div>
              </div>
            </div>

            {/* Deep-Space Downlink In-Transit Status Ribbon */}
            {renderInTransitBanner()}
          </div>

          {/* Earth MCC Health Telemetry Component fed by delayed Earth state */}
          <HealthTelemetryView
            hideHeader={true}
            initialAstronautId={activeMccAstronautId || 'AST-01_COMMANDER'}
            telemetryMap={mccTelemetryMap}
            marsDelay={marsDelay}
            connected={connected}
            latestAlert={mccAlert}
            onToggleMarsDelay={handleToggleMarsDelay}
            activeView={activeView}
            onSelectView={handleSelectView}
            onClose={handleCloseMccTelemetry}
            onAstronautChange={handleMccAstronautChange}
          />
        </div>
      )}

      {/* ─── 5. DEDICATED 3D HOLOGRAPHIC ANATOMICAL BODY SCANNER VIEW ─── */}
      {activeView === 'SCANNER' && (
        <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', backgroundColor: 'transparent' }}>
          {/* Top Sticky Header */}
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 200,
              width: '100%',
              padding: '12px 20px 0',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
              <HeaderBar
                connected={connected}
                marsDelay={marsDelay}
                onToggleMarsDelay={handleToggleMarsDelay}
                orbitalPosition={orbitalPosition}
                onSelectOrbitalPosition={handleOrbitalPositionChange}
                speedMultiplier={speedMultiplier}
                activeView={activeView}
                onSelectView={handleSelectView}
                latestAlert={latestAlert}
                selectedAstronautId={scannerAstronautId}
                scannerTheme={scannerTheme}
                onSelectScannerTheme={setScannerTheme}
                showEclssBar={showEclssBar}
                onToggleEclss={() => setShowEclssBar((prev) => !prev)}
                currentScenario={currentScenario}
                telemetryMap={telemetryMap}
                onOpenTriage={handleOpenTriage}
              />
            </div>
          </div>

          <main style={{ padding: '16px 20px 80px 20px', maxWidth: '1500px', margin: '0 auto', boxSizing: 'border-box' }}>
            {/* Crew Selector Ribbon for 3D Hologram */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
              padding: '10px 16px',
              background: 'linear-gradient(180deg, rgba(14, 22, 38, 0.75) 0%, rgba(9, 14, 24, 0.82) 100%)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: 14,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: '#68849e' }}>SELECT CREW MEMBER:</span>
                {[
                  { id: 'AST-01_COMMANDER', name: 'Haley', role: 'Commander', crewNo: 'CREW-01' },
                  { id: 'AST-02_PILOT', name: 'Chris', role: 'Pilot', crewNo: 'CREW-02' },
                  { id: 'AST-03_MEDICAL', name: 'Dr. Sian', role: 'Medical Specialist', crewNo: 'CREW-03' },
                  { id: 'AST-04_ENGINEER', name: 'Leo', role: 'Systems Engineer', crewNo: 'CREW-04' },
                ].map(c => {
                  const active = scannerAstronautId === c.id;
                  const crewTel = telemetryMap[c.id];
                  const isCrewAlert = crewTel?.evaluated_severity === 'CRITICAL' || crewTel?.evaluated_severity === 'WARNING' || (crewTel?.heart_rate ?? 60) > 100;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setScannerAstronautId(c.id)}
                      style={{
                        background: active ? '#10283d' : '#0b141e',
                        border: `1px solid ${active ? '#00e5ff' : '#1c2d3e'}`,
                        borderRadius: 4,
                        padding: '4px 10px',
                        color: active ? '#ffffff' : '#8aa2b8',
                        fontSize: 10,
                        fontWeight: active ? 700 : 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        transition: 'all 0.12s ease',
                      }}
                    >
                      <span>{c.crewNo} {c.name}</span>
                      {isCrewAlert && (
                        <span style={{ fontSize: 8, background: '#cf9834', color: '#04080e', padding: '0 4px', borderRadius: 2, fontWeight: 800 }}>
                          ALERT
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: '#68849e' }}>
                <span style={{ color: '#00e5ff', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00e5ff', boxShadow: '0 0 6px #00e5ff' }} />
                  <span>Interactive 3D WebGL Wireframe Active</span>
                </span>
                <span>·</span>
                <span>Click & Drag to Rotate 360°</span>
              </div>
            </div>

            {/* 3D Holographic Body Scanner Viewport */}
            {(() => {
              const currentCrew = [
                { id: 'AST-01_COMMANDER', name: 'Haley', role: 'Commander', crewNo: 'CREW-01' },
                { id: 'AST-02_PILOT', name: 'Chris', role: 'Pilot', crewNo: 'CREW-02' },
                { id: 'AST-03_MEDICAL', name: 'Dr. Sian', role: 'Medical Specialist', crewNo: 'CREW-03' },
                { id: 'AST-04_ENGINEER', name: 'Leo', role: 'Systems Engineer', crewNo: 'CREW-04' },
              ].find(c => c.id === scannerAstronautId) || { id: 'AST-02_PILOT', name: 'Chris', role: 'Pilot', crewNo: 'CREW-02' };

              return (
                <HolographicBodyScanner
                  astronautId={currentCrew.id}
                  astronautName={currentCrew.name}
                  astronautRole={currentCrew.role}
                  crewNo={currentCrew.crewNo}
                  telemetry={telemetryMap[currentCrew.id]}
                  themeMode="CYAN"
                  orbitalPosition={orbitalPosition}
                />
              );
            })()}
          </main>
        </div>
      )}

      {/* ─── 6. FIRST-PERSON ASTRONAUT SUIT VISOR HUD VIEW ─── */}
      {activeView === 'SUIT_HUD' && (
        <SuitHudView
          telemetryMap={telemetryMap}
          currentScenario={currentScenario}
          initialAstronautId={activeTriageAstronautId || targetAstronautId || 'AST-01_COMMANDER'}
          onExit={() => handleSelectView('HUD')}
        />
      )}

      {/* Global Scenario Controller (Floating Action Pill + Aerospace Modal) */}
      {activeView !== 'SUIT_HUD' && (
        <ScenarioController
          currentScenario={currentScenario}
          marsDelay={marsDelay}
          onToggleMarsDelay={handleToggleMarsDelay}
          onScenarioTriggered={handleScenarioTriggered}
          selectedCrewId={targetAstronautId || 'AST-01_COMMANDER'}
          onSelectCrewId={(id) => {
            setTargetAstronautId(id);
            targetAstronautIdRef.current = id;
          }}
        />
      )}
    </>
  );
}

export default App;
