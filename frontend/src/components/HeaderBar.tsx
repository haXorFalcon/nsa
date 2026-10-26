import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { audioService } from '../services/audioService';
import type { AlertPayload, DistancePreset, TelemetryPacket } from '../types/telemetry';
import { DISTANCES } from '../types/telemetry';
import './HeaderBar.css';

interface HeaderBarProps {
  connected: boolean;
  marsDelay?: boolean;
  onToggleMarsDelay?: (enabled: boolean) => void;
  orbitalPosition?: DistancePreset;
  onSelectOrbitalPosition?: (pos: DistancePreset) => void;
  speedMultiplier?: number;
  activeView?: 'HUD' | 'HEALTH_TELEMETRY' | 'MCC' | 'SCANNER' | 'MCC_TELEMETRY' | 'SUIT_HUD';
  onSelectView?: (view: 'HUD' | 'HEALTH_TELEMETRY' | 'MCC' | 'SCANNER' | 'MCC_TELEMETRY' | 'SUIT_HUD') => void;
  latestAlert?: AlertPayload | null;
  selectedAstronautId?: string;
  /** When true, renders ONLY the fixed bottom JARVIS bar — no top navbar */
  jarvisOnly?: boolean;
  scannerTheme?: 'CYAN' | 'THERMAL' | 'AMBER';
  onSelectScannerTheme?: (theme: 'CYAN' | 'THERMAL' | 'AMBER') => void;
  showEclssBar?: boolean;
  onToggleEclss?: () => void;
  currentScenario?: string;
  telemetryMap?: Record<string, TelemetryPacket>;
  onOpenTriage?: (astronautId: string) => void;
}

const formatChemicalSubscripts = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/\bCO2\b/g, 'CO₂')
    .replace(/\bSpO2\b/g, 'SpO₂')
    .replace(/\bO2\b/g, 'O₂')
    .replace(/\bK\+\b/g, 'K⁺');
};

const extractAdviceBody = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/^(?:(?:good\s+day|hello|urgent\s+alert|emergency|all\s+stations|all\s+crew\s+stations|all\s+crew)[,\s!:]+)?(?:(?:commander\s+\w+|pilot\s+\w+|doctor\s+\w+|specialist\s+\w+)(?:\s*(?:,|and)\s*(?:commander\s+\w+|pilot\s+\w+|doctor\s+\w+|specialist\s+\w+))*)[,\s!:]+/i, '')
    .trim()
    .toLowerCase();
};

export const HeaderBar: React.FC<HeaderBarProps> = ({
  connected,
  marsDelay,
  onToggleMarsDelay: _onToggleMarsDelay,
  orbitalPosition,
  onSelectOrbitalPosition: _onSelectOrbitalPosition,
  speedMultiplier = 1,
  activeView = 'HUD',
  onSelectView,
  latestAlert,
  selectedAstronautId: _selectedAstronautId = 'AST-01_COMMANDER',
  jarvisOnly = false,
  scannerTheme: _scannerThemeProp,
  onSelectScannerTheme: _onSelectScannerTheme,
  showEclssBar: _showEclssBarProp,
  onToggleEclss: _onToggleEclss,
  currentScenario: _currentScenario = 'NOMINAL_CRUISE',
  telemetryMap: _telemetryMap,
  onOpenTriage: _onOpenTriage,
}) => {
  const [audioEngaged, setAudioEngaged] = useState<boolean>(true);

  // Active Orbital Position & Light Propagation Delay (applies to Earth MCC views)
  const isEarthDomain = activeView === 'MCC' || activeView === 'MCC_TELEMETRY';
  const currentPos: DistancePreset = orbitalPosition || (marsDelay ? 'MARS_MAX' : 'LEO');
  const delaySec = isEarthDomain ? (DISTANCES[currentPos]?.delaySec ?? (marsDelay ? 1334.925 : 0)) : 0;

  // Earth Time (Ground MCC Houston UTC) — real-world clock
  const [earthTime, setEarthTime] = useState<Date>(() => new Date());
  // Base Spacecraft Mission Elapsed Time (Flight Day 14 at 08h 43m 22s)
  const [baseMetSeconds, setBaseMetSeconds] = useState<number>(14 * 86400 + 8 * 3600 + 43 * 60 + 22);

  // JARVIS in Header State
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isTransmitting, setIsTransmitting] = useState<boolean>(false);
  const [activeSpeech, setActiveSpeech] = useState<string>(
    latestAlert?.speech_text || 'All systems nominal. Sentry telemetry active.'
  );
  const [activeSeverity, setActiveSeverity] = useState<'CRITICAL' | 'WARNING' | 'INFO' | 'NOMINAL'>(
    latestAlert?.severity || 'NOMINAL'
  );
  const [displayedWordCount, setDisplayedWordCount] = useState<number>(0);

  const isSpeakingRef = useRef<boolean>(false);
  const activeSpeechTextRef = useRef<string>(activeSpeech);
  const pendingObservedAlertRef = useRef<AlertPayload | null>(null);
  const lastSpokenAdviceBodyRef = useRef<string>('');
  const lastSpokenTimestampRef = useRef<number>(0);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechWords = useMemo(() => {
    return activeSpeech.split(/\s+/).filter(Boolean);
  }, [activeSpeech]);
  const speechWordsRef = useRef<string[]>(speechWords);

  useEffect(() => {
    speechWordsRef.current = speechWords;
  }, [speechWords]);

  useEffect(() => {
    activeSpeechTextRef.current = activeSpeech;
  }, [activeSpeech]);

  useEffect(() => {
    // Enable audio service and unlock audio context
    audioService.setEngaged(true);
    const unlockAudio = () => {
      audioService.initAudioContext();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

    const timer = setInterval(() => {
      setEarthTime(new Date());
      setBaseMetSeconds((prev) => prev + speedMultiplier);
    }, 1000);
    return () => clearInterval(timer);
  }, [speedMultiplier]);


  const getMetParts = (totalSec: number) => {
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return {
      day: `T+${d}d`,
      time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
    };
  };

  const transmissionTheme = useMemo(() => {
    if (activeSeverity === 'CRITICAL') {
      return {
        bg: 'linear-gradient(90deg, rgba(225, 29, 72, 0.22) 0%, rgba(159, 18, 57, 0.14) 100%)',
        border: '1px solid rgba(244, 63, 94, 0.55)',
        glow: '0 4px 16px rgba(0, 0, 0, 0.65), 0 0 1px rgba(244, 63, 94, 0.35)',
        accentColor: '#f43f5e',
        textColor: '#cbd5e1',
        latestWordColor: '#ffffff',
        iconSrc: '/icons/critical.png',
        iconAlt: 'Critical Severity Alert',
      };
    }
    if (activeSeverity === 'WARNING') {
      return {
        bg: 'linear-gradient(90deg, rgba(245, 158, 11, 0.22) 0%, rgba(180, 83, 9, 0.14) 100%)',
        border: '1px solid rgba(251, 191, 36, 0.55)',
        glow: '0 4px 16px rgba(0, 0, 0, 0.65), 0 0 1px rgba(251, 191, 36, 0.35)',
        accentColor: '#fbbf24',
        textColor: '#cbd5e1',
        latestWordColor: '#ffffff',
        iconSrc: '/icons/warning.png',
        iconAlt: 'Warning Severity Alert',
      };
    }
    // NOMINAL / INFO
    return {
      bg: 'linear-gradient(90deg, rgba(14, 165, 233, 0.20) 0%, rgba(3, 105, 161, 0.12) 100%)',
      border: '1px solid rgba(56, 189, 248, 0.5)',
      glow: '0 4px 16px rgba(0, 0, 0, 0.65), 0 0 1px rgba(56, 189, 248, 0.3)',
      accentColor: '#38bdf8',
      textColor: '#cbd5e1',
      latestWordColor: '#ffffff',
      iconSrc: '/icons/heartbeat_blue.png',
      iconAlt: 'Nominal Baseline Transmission',
    };
  }, [activeSeverity]);


  const handleToggleAudio = () => {
    const next = !audioEngaged;
    audioService.setEngaged(next);
    setAudioEngaged(next);
    if (next) {
      audioService.playTone('chime');
    }
  };

  /**
   * Speak Statement Handler:
   * Queues speech with audioService. Text updates strictly inside onStart
   * to guarantee lockstep audio/text synchronization without premature text flashing.
   */
  const speakStatement = (
    text: string,
    tone: 'klaxon' | 'chime' | 'beep' | 'none' = 'chime',
    config: { severity?: 'CRITICAL' | 'WARNING' | 'INFO' | 'NOMINAL'; rate?: number; volume?: number } = {}
  ) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    const sev = config.severity || 'NOMINAL';

    // Clear any pending dismiss
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }

    setActiveSeverity(sev);
    lastSpokenAdviceBodyRef.current = extractAdviceBody(cleanText);
    lastSpokenTimestampRef.current = Date.now();

    if (!audioService.getEngaged()) {
      audioService.setEngaged(true);
    }

    audioService.queueSpeech({
      text: cleanText,
      tone,
      config: {
        ...config,
        severity: sev,
      },
      callbacks: {
        onStart: () => {
          // Streaming begins the exact instant audio begins playing — lockstep sync
          isSpeakingRef.current = true;
          setIsSpeaking(true);
          setIsTransmitting(true);
          setActiveSpeech(cleanText);
          activeSpeechTextRef.current = cleanText;

          const words = cleanText.split(/\s+/).filter(Boolean);
          speechWordsRef.current = words;
          setDisplayedWordCount(1);
        },
        onWord: (_wordIndex: number, progress?: number) => {
          const total = speechWordsRef.current.length;
          if (typeof progress === 'number' && progress >= 0) {
            const targetCount = Math.min(total, Math.max(1, Math.ceil(progress * total)));
            setDisplayedWordCount((prev) => Math.max(prev, targetCount));
          } else {
            setDisplayedWordCount((prev) => Math.min(total, Math.max(prev, _wordIndex + 1)));
          }
        },
        onEnd: () => {
          const totalWords = activeSpeechTextRef.current.split(/\s+/).filter(Boolean).length;
          setDisplayedWordCount(totalWords);
          handleSpeechFinished();
        },
      },
    });
  };

  /**
   * When speech ends, evaluate buffered changes or schedule auto-dismiss.
   */
  const handleSpeechFinished = () => {
    isSpeakingRef.current = false;
    setIsSpeaking(false);

    // If new changes were observed & buffered while speaking, play them now after quiet break
    const pending = pendingObservedAlertRef.current;
    if (pending && pending.speech_text) {
      const pendingAdvice = extractAdviceBody(pending.speech_text);
      if (pendingAdvice && pendingAdvice === lastSpokenAdviceBodyRef.current) {
        pendingObservedAlertRef.current = null;
      } else if (pending.speech_text !== activeSpeechTextRef.current) {
        pendingObservedAlertRef.current = null;
        setTimeout(() => {
          if (!isSpeakingRef.current) {
            speakStatement(
              pending.speech_text,
              pending.tone || (pending.severity === 'CRITICAL' ? 'klaxon' : 'chime'),
              {
                ...pending.audio_config,
                severity: pending.severity,
              }
            );
          }
        }, 3500);
        return;
      }
    }

    // Keep transmission navbar readable after transmission ends (12 seconds)
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
    autoDismissTimerRef.current = setTimeout(() => {
      setIsTransmitting(false);
    }, 12000);
  };

  // React to incoming WebSocket alerts
  useEffect(() => {
    if (!latestAlert || !latestAlert.speech_text) return;

    const alertText = latestAlert.speech_text.trim();
    if (!alertText) return;

    // Prevent duplicate triggers of identical text
    if (alertText === activeSpeechTextRef.current) return;

    // Semantic deduplication: if core advice was recently spoken (<8s), ignore without re-triggering
    const incomingAdvice = extractAdviceBody(alertText);
    const timeSinceLastSpoken = Date.now() - lastSpokenTimestampRef.current;
    if (incomingAdvice && incomingAdvice === lastSpokenAdviceBodyRef.current && timeSinceLastSpoken < 8000) {
      return;
    }

    const isEmergency = latestAlert.severity === 'CRITICAL' || latestAlert.severity === 'WARNING';
    const isHigherPriority =
      (latestAlert.severity === 'CRITICAL' && activeSeverity !== 'CRITICAL') ||
      (latestAlert.severity === 'WARNING' && activeSeverity === 'NOMINAL');

    if (isEmergency && (isHigherPriority || !isSpeakingRef.current || activeSeverity === 'NOMINAL')) {
      // PREEMPT IMMEDIATELY: Stop lower-priority speech, sound emergency tone, and deliver emergency directive
      audioService.stopSpeaking();
      pendingObservedAlertRef.current = null;
      speakStatement(
        latestAlert.speech_text,
        latestAlert.tone || (latestAlert.severity === 'CRITICAL' ? 'klaxon' : 'chime'),
        {
          ...latestAlert.audio_config,
          severity: latestAlert.severity,
        }
      );
      return;
    }

    if (isSpeakingRef.current) {
      // Buffer sequential telemetry calculation for playback after current speech completes
      pendingObservedAlertRef.current = latestAlert;
    } else {
      speakStatement(
        latestAlert.speech_text,
        latestAlert.tone || 'chime',
        {
          ...latestAlert.audio_config,
          severity: latestAlert.severity,
        }
      );
    }
  }, [latestAlert, activeSeverity]);


  // ── JARVIS FIXED BOTTOM BAR (shared across HUD and Telemetry views) ──
  const jarvisBar = (
    <div
      className="jarvis-transmission-navbar"
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '50%',
        zIndex: 9999,
        // Slide up from below when transmitting, slide back down when not
        transform: isTransmitting ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(90px)',
        transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease',
        opacity: isTransmitting ? 1 : 0,
        pointerEvents: isTransmitting ? 'auto' : 'none',
        background: 'rgba(9, 14, 24, 0.88)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: `1px solid ${transmissionTheme.accentColor}55`,
        borderRadius: '16px',
        boxShadow: `0 16px 48px rgba(0, 0, 0, 0.7), 0 0 24px ${transmissionTheme.accentColor}18, inset 0 1px 0 rgba(255,255,255,0.12)`,
        boxSizing: 'border-box',
        maxWidth: '1400px',
        width: 'calc(100% - 32px)',
        overflow: 'hidden',
      }}
    >
      {/* Inner container */}
      <div
        style={{
          margin: '0 auto',
          padding: '0 16px',
          height: '52px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          boxSizing: 'border-box',
          width: '100%',
        }}
      >
        {/* PINNED LEFT: Severity Icon + JARVIS Label + Audio Bars */}
        <div
          className="hud-tooltip-trigger"
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '0 14px 0 0',
            borderRight: 'rgba(255, 255, 255, 0.08) 1px solid',
            flexShrink: 0,
            cursor: 'default',
          }}
        >
          <img
            src={transmissionTheme.iconSrc}
            alt={transmissionTheme.iconAlt}
            style={{ width: '20px', height: '20px', objectFit: 'contain', flexShrink: 0, filter: 'drop-shadow(0 0 5px rgba(0,0,0,0.7))' }}
          />
          <span
            style={{
              fontFamily: "'Orbitron', var(--hud-font-brand, system-ui, sans-serif)",
              fontSize: '11px',
              fontWeight: 900,
              letterSpacing: '0.14em',
              color: transmissionTheme.accentColor,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            AI SURGEON
          </span>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '14px', width: '14px', flexShrink: 0 }}>
            {(['hud-bar-anim-1', 'hud-bar-anim-2', 'hud-bar-anim-3'] as const).map((cls, i) => (
              <span
                key={i}
                className={isSpeaking ? cls : ''}
                style={{
                  width: '2px',
                  height: '14px',
                  backgroundColor: transmissionTheme.accentColor,
                  borderRadius: '1px',
                  transform: isSpeaking ? undefined : `scaleY(${i === 1 ? 0.5 : 0.25})`,
                  transformOrigin: 'bottom',
                  transition: 'transform 0.2s ease',
                }}
              />
            ))}
          </div>
          <div className="hud-tooltip hud-tooltip-up">
            AI medical assistant
          </div>
        </div>

        {/* MIDDLE: Streaming AI telemetry text */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '5px',
            flex: 1,
            minWidth: 0,
            padding: '6px 14px',
            backgroundColor: '#0c0d10',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '6px',
            boxShadow: 'inset 0 1px 4px rgba(0, 0, 0, 0.7)',
            height: '38px',
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}
        >
          {speechWords.slice(0, displayedWordCount).map((word: string, idx: number) => {
            const isLatest = isSpeaking && idx === displayedWordCount - 1;
            return (
              <span
                key={`${idx}-${word}`}
                className="jarvis-word-item"
                style={{
                  color: isLatest ? transmissionTheme.latestWordColor : transmissionTheme.textColor,
                  fontFamily: "var(--hud-font-mono, 'Tomorrow', monospace)",
                  fontSize: '12px',
                  fontWeight: isLatest ? 700 : 500,
                  letterSpacing: '0.02em',
                  textShadow: isLatest ? `0 0 10px ${transmissionTheme.accentColor}` : 'none',
                  transition: 'color 0.15s ease, text-shadow 0.15s ease',
                }}
              >
                {formatChemicalSubscripts(word)}
              </span>
            );
          })}
          {isSpeaking && (
            <span
              className="jarvis-pulse-cursor"
              style={{
                display: 'inline-block',
                width: '6px',
                height: '13px',
                backgroundColor: transmissionTheme.accentColor,
                borderRadius: '1px',
                marginLeft: '2px',
                boxShadow: `0 0 8px ${transmissionTheme.accentColor}`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );

  // When jarvisOnly: skip the top nav, return only the fixed JARVIS bar
  if (jarvisOnly) {
    return jarvisBar;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      {/* ── MAIN UNIVERSAL FLOATING COMMAND CAPSULE (MATCHING REFERENCE IMAGE 2) ── */}
      <header
        aria-label="HELIOS Biometric Flight Deck Universal Command Bar"
        className="helios-header-capsule"
      >
        {/* 1. Left: Brand Name + Status Badge + Divider */}
        <div className="helios-header-left">
          <button
            type="button"
            onClick={() => onSelectView?.('HUD')}
            title="HELIOS Flight Deck - Return to Dashboard"
            className="helios-brand-btn"
          >
            <span className="helios-brand-title">HELIOS</span>
            <span
              className={`helios-status-pill ${
                connected ? 'helios-status-pill--online' : 'helios-status-pill--offline'
              }`}
            >
              <span className="helios-status-dot" />
              <span>{connected ? 'ONLINE' : 'OFFLINE'}</span>
            </span>
          </button>
          <span className="helios-header-divider">|</span>
        </div>

        {/* 2. Center: Sleek Universal Navigation Capsule */}
        {onSelectView && (
          <div className="helios-header-center">
            <nav aria-label="Universal Navigation" className="helios-nav-capsule">
              {[
                { id: 'HUD', label: 'Dashboard' },
                { id: 'HEALTH_TELEMETRY', label: 'Health-Telemetry' },
                { id: 'MCC', label: 'Earth MCC' },
                { id: 'SCANNER', label: '3D Scanner' },
                { id: 'SUIT_HUD', label: 'Suit HUD' },
              ].map((tab) => {
                const isActive =
                  activeView === tab.id || (tab.id === 'MCC' && activeView === 'MCC_TELEMETRY');
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onSelectView(tab.id as any)}
                    className={`helios-nav-tab ${isActive ? 'helios-nav-tab--active' : ''}`}
                  >
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        {/* 3. Right: Spacecraft Telemetry Clocks + Audio Control */}
        <div className="helios-header-right">
          <div className="helios-header-clocks">
            <span className="helios-clock-item">
              <span className="helios-clock-label">EARTH</span>{' '}
              <span className="helios-clock-val helios-clock-val--earth">
                {earthTime.toISOString().substring(11, 19)}
              </span>{' '}
              <span className="helios-clock-zone">UTC</span>
            </span>
            <span className="helios-clock-divider">|</span>
            <span className="helios-clock-item">
              <span className="helios-clock-label">SPACECRAFT</span>{' '}
              <span className="helios-clock-val helios-clock-val--spacecraft">
                {new Date(earthTime.getTime() - Math.round(delaySec) * 1000).toISOString().substring(11, 19)}
              </span>{' '}
              <span className="helios-clock-zone">SVT</span>
            </span>
            <span className="helios-clock-item helios-clock-item--met">
              <span className="helios-clock-label">MET</span>{' '}
              <span className="helios-clock-val helios-clock-val--met">
                {getMetParts(Math.max(0, baseMetSeconds - Math.round(delaySec))).day}{' '}
                {getMetParts(Math.max(0, baseMetSeconds - Math.round(delaySec))).time}
              </span>
            </span>
          </div>

          {/* Voice Audio Toggle Button */}
          <button
            type="button"
            onClick={handleToggleAudio}
            title={audioEngaged ? 'Turn voice alerts off' : 'Turn voice alerts on'}
            className={`helios-audio-pill ${
              audioEngaged ? 'helios-audio-pill--active' : 'helios-audio-pill--inactive'
            }`}
          >
            {audioEngaged ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
        </div>
      </header>

      {/* ── JARVIS FIXED BOTTOM TRANSMISSION BAR ── */}
      {jarvisBar}
    </div>
  );
};

export default HeaderBar;

