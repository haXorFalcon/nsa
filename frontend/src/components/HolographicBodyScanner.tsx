import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { TelemetryPacket, DistancePreset } from '../types/telemetry';
import { DISTANCES, fmtTime } from '../types/telemetry';
import { evaluateCrewClinicalSummary } from '../utils/clinicalPrioritization';
import {
  User,
  Shield,
  Columns2,
  Maximize2,
  Play,
  Pause,
  Zap,
  Crosshair,
  Radio,
  CheckCircle2,
  AlertTriangle,
  X,
  Flame,
  Sun,
  Activity,
} from 'lucide-react';
import {
  HUMAN_VERTICES,
  HUMAN_TRI_INDICES,
  HUMAN_LINE_INDICES,
} from '../data/humanMeshGeometry';
import {
  HAZARD_TARGETS,
  type HazardTarget,
  generateStardustPointCloud,
  getVascularLineSegments,
  getVascularPoints,
  getHeartPoints,
  getSkeletonLineSegments,
  getSkeletonPoints,
  getBrainNeuralNetwork,
} from '../data/vascularGeometry';

export interface HolographicBodyScannerProps {
  astronautId: string;
  astronautName: string;
  astronautRole: string;
  crewNo: string;
  telemetry?: TelemetryPacket;
  themeMode?: 'CYAN' | 'THERMAL' | 'AMBER' | 'HEATMAP' | 'AEROSPACE';
  orbitalPosition?: DistancePreset;
  onSelectSubsystem?: (subsystem: 'OCULAR' | 'CARDIAC' | 'RENAL' | 'SKELETAL') => void;
}

export function normalizeTheme(mode?: string): 'CYAN' | 'THERMAL' | 'AMBER' {
  if (mode === 'THERMAL' || mode === 'HEATMAP') return 'THERMAL';
  if (mode === 'AMBER' || mode === 'AEROSPACE') return 'AMBER';
  return 'CYAN';
}

interface Hotspot {
  id: 'OCULAR' | 'CARDIAC' | 'RENAL' | 'SKELETAL';
  label: string;
  subsystemName: string;
  elevationTag: string;
  organ: string;
  pos: [number, number, number];
  scanTargetY: number;
  severity: 'NOMINAL' | 'WARNING' | 'CRITICAL';
  metric: string;
  detail: string;
  region: string;
  protocol: string;
}

// Anatomical cross-section radius lookup function for dynamic tomographic body contouring
function getBodyContourRadii(y: number): { rx: number; rz: number } {
  if (y > 1.15) {
    const t = Math.max(0, Math.min(1, (y - 1.15) / 0.35));
    return { rx: 0.16 + 0.03 * (1 - t), rz: 0.19 };
  } else if (y > 0.80) {
    const t = (y - 0.80) / 0.35;
    return { rx: 0.22 + 0.16 * (1 - t), rz: 0.18 + 0.05 * (1 - t) };
  } else if (y > 0.45) {
    const t = (y - 0.45) / 0.35;
    return { rx: 0.34 + 0.08 * t, rz: 0.21 + 0.04 * t };
  } else if (y > 0.05) {
    const t = (y - 0.05) / 0.40;
    return { rx: 0.25 + 0.08 * t, rz: 0.18 + 0.03 * t };
  } else if (y > -0.30) {
    return { rx: 0.30, rz: 0.20 };
  } else if (y > -0.85) {
    const t = (y + 0.85) / 0.55;
    return { rx: 0.25 + 0.04 * t, rz: 0.16 + 0.03 * t };
  } else if (y > -1.30) {
    const t = (y + 1.30) / 0.45;
    return { rx: 0.20 + 0.04 * t, rz: 0.14 + 0.02 * t };
  } else {
    return { rx: 0.22, rz: 0.18 };
  }
}

export const HolographicBodyScanner: React.FC<HolographicBodyScannerProps> = ({
  astronautId,
  astronautName,
  astronautRole: _astronautRole,
  crewNo,
  telemetry,
  themeMode: initialTheme = 'CYAN',
  orbitalPosition = 'LEO',
  onSelectSubsystem,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [selectedHotspot, setSelectedHotspot] = useState<'OCULAR' | 'CARDIAC' | 'RENAL' | 'SKELETAL'>('CARDIAC');
  const [activeHazard, setActiveHazard] = useState<string | null>('ENVIRONMENT');
  const [autoRotate, setAutoRotate] = useState(false);
  const [colorTheme, setColorTheme] = useState<'CYAN' | 'THERMAL' | 'AMBER'>(() => normalizeTheme(initialTheme));
  const [laserMode, setLaserMode] = useState<'SWEEP' | 'LOCK_ORGAN' | 'OFF'>('OFF');
  const [modelType, setModelType] = useState<'HUMAN' | 'SUIT'>('HUMAN');
  const [viewMode, setViewMode] = useState<'SPLIT' | 'FULL'>('SPLIT');
  const [showHazardModal, setShowHazardModal] = useState(false);
  const [selectedSuitSubsystem, setSelectedSuitSubsystem] = useState<'VISOR' | 'PLSS' | 'DCM' | 'SAFER' | 'TMG'>('PLSS');

  // Sync prop changes
  useEffect(() => {
    if (initialTheme) {
      setColorTheme(normalizeTheme(initialTheme));
    }
  }, [initialTheme]);

  // Direct DOM references for 60 FPS HUD telemetry updates without triggering React re-renders
  const elevationDomRef = useRef<HTMLSpanElement>(null);
  const regionDomRef = useRef<HTMLSpanElement>(null);
  const sliceIndexDomRef = useRef<HTMLSpanElement>(null);
  const azimuthDomRef = useRef<HTMLSpanElement>(null);
  const elevationRulerChevronRef = useRef<HTMLDivElement>(null);

  // SVG lines and hotspot target ring DOM references for 60 FPS lag-free tracking
  const lineRefs = useRef<Record<string, SVGLineElement | null>>({});
  const ringRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const containerSizeRef = useRef({ width: 540, height: 500 });

  // ── CLINICAL SUMMARY & ANOMALY RESOLUTION FOR BIO-TWIN ──
  const clinical = useMemo(() => {
    return evaluateCrewClinicalSummary(astronautId, telemetry || {});
  }, [astronautId, telemetry]);

  const primaryBiomarker = clinical.prioritizedBiomarkers[0];
  const primaryBioId = primaryBiomarker?.id;
  const primaryBioTier = primaryBiomarker?.tier;

  const hr = telemetry?.heart_rate ?? 64;
  const spo2 = telemetry?.spo2 ?? 98.6;
  const hct = telemetry?.hematocrit ?? 42.0;
  const k = telemetry?.potassium ?? 4.4;
  const co2 = telemetry?.cabin_co2 ?? 1.82;
  const temp = telemetry?.core_temp ?? 36.6;
  const radFlux = telemetry?.radiation_flux ?? 0.04;
  const radDose = telemetry?.radiation_dose_gy ?? 0.0;
  const trm = telemetry?.computed_trm ?? 1.0;
  const qtc = telemetry?.computed_qtc ?? 405;
  const arf = telemetry?.computed_arf ?? 0.0;
  const bmd = (telemetry as any)?.bmd_index ?? 94.5;

  // Global Bio-Twin Severity
  const isCriticalAlert = telemetry?.evaluated_severity === 'CRITICAL' ||
    clinical.severity === 'CRITICAL' ||
    spo2 < 90.0 ||
    hr > 115 ||
    (telemetry?.potassium !== undefined && telemetry.potassium < 3.0) ||
    radFlux > 10.0;

  const isWarningAlert = !isCriticalAlert && (
    telemetry?.evaluated_severity === 'WARNING' ||
    clinical.severity === 'WARNING' ||
    clinical.isAbnormal ||
    hr > 88 ||
    spo2 < 96.5 ||
    co2 > 2.8 ||
    hct > 48.0 ||
    trm > 1.40 ||
    (telemetry?.potassium !== undefined && (telemetry.potassium < 3.5 || telemetry.potassium > 5.2))
  );

  const activeSeverity: 'CRITICAL' | 'WARNING' | 'NOMINAL' = isCriticalAlert ? 'CRITICAL' : isWarningAlert ? 'WARNING' : 'NOMINAL';

  // Subsystem Specific Severities
  // 1. Cardiac
  const isCardiacCritical = isCriticalAlert && (primaryBioId === 'hr' || primaryBioId === 'arf' || primaryBioId === 'spo2' || hr > 105 || qtc > 465 || arf > 1.0 || spo2 < 90.0);
  const isCardiacWarning = isWarningAlert && (primaryBioId === 'hr' || primaryBioId === 'arf' || primaryBioId === 'hct' || hr > 85 || qtc > 440 || trm > 1.40);
  const cardiacSeverity: 'CRITICAL' | 'WARNING' | 'NOMINAL' = isCardiacCritical ? 'CRITICAL' : isCardiacWarning ? 'WARNING' : 'NOMINAL';

  // 2. Renal & Cortical Perfusion (Fluid Shift & Hemoconcentration)
  const isRenalCritical = (telemetry?.potassium !== undefined && telemetry.potassium < 3.0) || (primaryBioId === 'hct' && primaryBioTier === 'CRITICAL');
  const isRenalAlert = isRenalCritical ||
    (telemetry?.potassium !== undefined && (telemetry.potassium < 3.5 || telemetry.potassium > 5.2)) ||
    primaryBioId === 'hct' ||
    hct > 48.0 ||
    telemetry?.scenario_phase === 'SCENARIO_14_NEPHROLITHIASIS' ||
    telemetry?.scenario_phase === 'SCENARIO_15_INTRAVASCULAR_DEHYDRATION';
  const renalSeverity: 'CRITICAL' | 'WARNING' | 'NOMINAL' = isRenalCritical ? 'CRITICAL' : isRenalAlert ? 'WARNING' : 'NOMINAL';

  // 3. Cranial & Neuro-Ocular (SANS)
  const isOcularAlert = telemetry?.scenario_phase === 'SCENARIO_17_SPACE_VISION_SANS' || co2 > 3.2 || primaryBioId === 'co2';
  const ocularSeverity: 'CRITICAL' | 'WARNING' | 'NOMINAL' = isOcularAlert ? 'WARNING' : 'NOMINAL';

  // 4. Musculoskeletal & Deconditioning
  const isSkeletalAlert = telemetry?.scenario_phase === 'SCENARIO_8_CARDIOVASCULAR_DECONDITIONING' || bmd < 90.0 || (primaryBioId === 'hct' && trm > 1.4);
  const skeletalSeverity: 'CRITICAL' | 'WARNING' | 'NOMINAL' = bmd < 85.0 ? 'CRITICAL' : isSkeletalAlert ? 'WARNING' : 'NOMINAL';

  // Synchronous refs for WebGL 60 FPS animation loop
  const hrRef = useRef(hr);
  const autoRotateRef = useRef(autoRotate);
  const laserModeRef = useRef(laserMode);
  const modelTypeRef = useRef(modelType);
  const selectedHotspotRef = useRef(selectedHotspot);
  const onSelectSubsystemRef = useRef(onSelectSubsystem);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const snapTargetAzimuthRef = useRef<number | null>(null);
  const targetFocusYRef = useRef<number | null>(null);
  const updateMaterialsRef = useRef<((theme: string, severity: 'CRITICAL' | 'WARNING' | 'NOMINAL') => void) | null>(null);
  const switchModelRef = useRef<((type: 'HUMAN' | 'SUIT') => void) | null>(null);
  const focusSuitSubsystemRef = useRef<((id: 'VISOR' | 'PLSS' | 'DCM' | 'SAFER' | 'TMG') => void) | null>(null);
  const activeSeverityRef = useRef(activeSeverity);

  useEffect(() => {
    activeSeverityRef.current = activeSeverity;
  }, [activeSeverity]);

  useEffect(() => {
    hrRef.current = hr;
  }, [hr]);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  useEffect(() => {
    laserModeRef.current = laserMode;
  }, [laserMode]);

  useEffect(() => {
    selectedHotspotRef.current = selectedHotspot;
  }, [selectedHotspot]);

  useEffect(() => {
    onSelectSubsystemRef.current = onSelectSubsystem;
  }, [onSelectSubsystem]);

  useEffect(() => {
    if (updateMaterialsRef.current) {
      updateMaterialsRef.current(colorTheme, activeSeverity);
    }
  }, [colorTheme, activeSeverity]);

  const MESH_SCALE = 0.82;

  const hotspots: Hotspot[] = useMemo(() => [
    {
      id: 'OCULAR',
      label: 'Cranial / SANS Ocular',
      subsystemName: 'Optic Nerve Sheath (SANS)',
      elevationTag: '+1.32m Cranial',
      organ: 'Optic Disc / Papilledema',
      region: 'CRANIAL (+1.32m)',
      pos: [0, 1.32 * MESH_SCALE, 0.14 * MESH_SCALE],
      scanTargetY: 1.32 * MESH_SCALE,
      severity: ocularSeverity,
      metric: isOcularAlert
        ? 'ONSD 6.8 mm · Retinal Engorgement · SANS Grade 2'
        : 'ONSD 5.2 mm · Retinal Microaneurysm 0',
      detail: isOcularAlert
        ? 'Cephalad venous fluid shift exceeding nominal ICP thresholds. Optic disc sheath enlargement.'
        : 'Cephalad venous fluid shift within nominal intracranial limits. Grade 0 Frisen papilledema.',
      protocol: isOcularAlert
        ? 'Deploy chinstrap negative-pressure lower body suit (LBNP); scheduled ultrasound OCT.'
        : 'Funduscopic OCT scan (NASA SANS Protocol B) q48h; assess for disc margin blur.',
    },
    {
      id: 'CARDIAC',
      label: 'Cardiovascular / Myocardium',
      subsystemName: 'Cardiac Rhythm & QTc',
      elevationTag: '+0.70m Thoracic',
      organ: 'Left Ventricle / Conduction Axis',
      region: 'THORACIC (+0.70m)',
      pos: [-0.08 * MESH_SCALE, 0.72 * MESH_SCALE, 0.16 * MESH_SCALE],
      scanTargetY: 0.72 * MESH_SCALE,
      severity: cardiacSeverity,
      metric: isCardiacCritical
        ? `HR ${Math.round(hr)} bpm · QTc ${qtc}ms · ARF ${arf.toFixed(2)}`
        : primaryBioId === 'hct' || trm > 1.40
          ? `HR ${Math.round(hr)} bpm · TRM ${trm.toFixed(2)} · Viscosity Elevated`
          : isCardiacWarning
            ? `HR ${Math.round(hr)} bpm · QTc ${qtc}ms · Elevated Strain`
            : `HR ${Math.round(hr)} bpm · QTc ${qtc}ms · Stable`,
      detail: isCardiacCritical
        ? (k < 3.5
          ? `Compensatory sinus tachycardia secondary to severe exertional hypokalemia (K+ ${k.toFixed(2)} mmol/L).`
          : `Critical cardiovascular strain under active mission scenario (SpO₂ ${spo2.toFixed(1)}%).`)
        : primaryBioId === 'hct'
          ? `Intravascular hemoconcentration increasing whole blood viscosity & left ventricular afterload.`
          : isCardiacWarning
            ? `Elevated cardiovascular workload. Compensatory chronotropic response under mission stress.`
            : 'Resting sinus rhythm; physiological cardiac output in nominal microgravity baseline.',
      protocol: isCardiacCritical
        ? 'Initiate KCl oral electrolyte replacement pack (20-40 mEq); suspend EVA excursion.'
        : primaryBioId === 'hct'
          ? 'Maintain scheduled oral hydration protocol; monitor central venous pressure and thrombosis risk.'
          : isCardiacWarning
            ? 'Monitor continuous 12-lead vectorcardiography; titrate workload limits.'
            : 'Maintain nominal telemetry logging; scheduled submaximal VO2-max cycle.',
    },
    {
      id: 'RENAL',
      label: 'Renal / Cortical Perfusion',
      subsystemName: 'Renal Perfusion & Osmolality',
      elevationTag: '+0.18m Abdominal',
      organ: 'Bilateral Renal Cortices',
      region: 'ABDOMINAL (+0.18m)',
      pos: [-0.14 * MESH_SCALE, 0.18 * MESH_SCALE, 0.12 * MESH_SCALE],
      scanTargetY: 0.18 * MESH_SCALE,
      severity: renalSeverity,
      metric: isRenalCritical
        ? `CRITICAL K+ ${k.toFixed(2)} · Urine Osm 920 mOsm/kg`
        : primaryBioId === 'hct' || hct > 48.0
          ? `Hct ${hct.toFixed(1)}% · Hemoconcentration ${primaryBioTier === 'CRITICAL' ? 'Critical' : 'Alert'} · Prerenal Shift`
          : isRenalAlert
            ? `K+ ${k.toFixed(2)} · Urine Osm 810 mOsm/kg`
            : 'K+ 4.3 mmol/L · Urine Osm 450 mOsm/kg · Nominal',
      detail: primaryBioId === 'hct' || hct > 48.0
        ? `Intravascular plasma volume contraction with hemoconcentration (+${Math.abs(((hct - (primaryBiomarker?.baseline || 43.8)) / (primaryBiomarker?.baseline || 43.8)) * 100).toFixed(0)}% vs baseline). Renal cortical resistance elevated.`
        : isRenalAlert
          ? 'Prerenal azotemia & sodium-potassium ATPase pump exhaustion secondary to microgravity fluid loss.'
          : 'Normal bilateral cortical glomerular filtration; fluid intake counteracting cephalic stasis.',
      protocol: primaryBioId === 'hct' || hct > 48.0
        ? 'Administer 1000 mL chilled electrolyte oral hydration pack; re-evaluate urine osmolality & Hct q2h.'
        : isRenalAlert
          ? 'Administer 750 mL chilled electrolyte oral hydration; reassess specific gravity.'
          : 'Routine fluid balance protocol (2.5 L/24h consumption target).',
    },
    {
      id: 'SKELETAL',
      label: 'Musculoskeletal / Femoral',
      subsystemName: 'Bone Density (BMD)',
      elevationTag: '-0.57m Femoral',
      organ: 'Bone Mineral Density (BMD)',
      region: 'FEMORAL (-0.57m)',
      pos: [0.12 * MESH_SCALE, -0.62 * MESH_SCALE, 0.12 * MESH_SCALE],
      scanTargetY: -0.62 * MESH_SCALE,
      severity: skeletalSeverity,
      metric: isSkeletalAlert
        ? `BMD Loss Alert · Index ${bmd.toFixed(1)}%`
        : `BMD Index ${bmd.toFixed(1)}% · ARED 11.8 MJ`,
      detail: isSkeletalAlert
        ? 'Trabecular micro-architecture deconditioning under prolonged zero-G unloading.'
        : 'Resistive countermeasure exercise maintaining trabecular load profile.',
      protocol: isSkeletalAlert
        ? 'Increase ARED resistive squat/deadlift loading to 180 kN; add dietary vitamin D3.'
        : 'Maintain ARED resistive deadlift & squat cycles (150 kN load target)',
    },
  ], [cardiacSeverity, renalSeverity, ocularSeverity, skeletalSeverity, hr, spo2, hct, k, trm, qtc, arf, bmd, telemetry, isCardiacCritical, isCardiacWarning, isRenalAlert, isRenalCritical, isOcularAlert, isSkeletalAlert, clinical]);

  // Interactive EVA Spacesuit Subsystems & Real-Time Specifications
  const suitSubsystems = useMemo(() => [
    {
      id: 'VISOR' as const,
      label: 'VISOR / HUD',
      name: 'Extravehicular Visor Assembly (EVVA)',
      spec: 'Gold vapor-deposited polycarbonate shielding 100% solar UV & IR. Optical grade anti-fog matrix.',
      telemetry: 'Tint: 94% · CO₂ Sentry: Nominal · Retinal Projection: Calibrated',
      status: 'ACTIVE',
      color: '#fbbf24',
      targetY: 0.85,
    },
    {
      id: 'PLSS' as const,
      label: 'PLSS BACKPACK',
      name: 'Portable Life Support System',
      spec: 'Dual 27.6 MPa O₂ tanks, regenerable amine CO₂ scrubbers, sublimator ice evaporator loop.',
      telemetry: 'Primary O₂: 98.4% · Scrubbed CO₂: 0.2 mmHg · Sublimator: 1.2 L/h nominal',
      status: 'OPTIMAL',
      color: '#00e5ff',
      targetY: 0.40,
    },
    {
      id: 'DCM' as const,
      label: 'DCM CHEST MODULE',
      name: 'Display & Control Module',
      spec: 'Chest-mounted operational controls: suit pressure regulator, primary/secondary oxygen actuator.',
      telemetry: 'Pressure: 29.6 kPa (4.3 psi pure O₂) · Comm: S-Band Primary Online',
      status: 'NOMINAL',
      color: '#38bdf8',
      targetY: 0.18,
    },
    {
      id: 'SAFER' as const,
      label: 'SAFER RCS',
      name: 'Simplified Aid for EVA Rescue',
      spec: 'Self-rescue cold-gas nitrogen thruster pack with 24 nozzles delivering 3.05 m/s delta-V.',
      telemetry: 'GN₂ Pressure: 20.7 MPa · 24 Nozzles Armed · Flight Controller Ready',
      status: 'ARMED',
      color: '#00e5a3',
      targetY: -0.10,
    },
    {
      id: 'TMG' as const,
      label: 'TMG LAYERS',
      name: 'Thermal Micrometeoroid Garment',
      spec: '14-layer ortho-fabric, aluminized Mylar insulation, and Kevlar puncture-resistant outer weave.',
      telemetry: 'Ext Temp: -48°C / +62°C · Micrometeoroid Puncture Sensors: 0 (Nominal)',
      status: 'SEALED',
      color: '#a855f7',
      targetY: -0.45,
    },
  ], []);

  // Dynamic 5 NASA Hazards calculated live from telemetry, clinical status, and orbital position
  const dynamicHazards = useMemo<HazardTarget[]>(() => {
    // 1. Distance Hazard
    const distPreset = orbitalPosition || 'LEO';
    let distStatus: 'NOMINAL' | 'WATCH' | 'CRITICAL' = 'NOMINAL';
    let distColor = '#00e5a3';
    if (distPreset === 'MARS_MAX') {
      distStatus = 'CRITICAL';
      distColor = '#ef4444';
    } else if (distPreset === 'MARS_MIN') {
      distStatus = 'WATCH';
      distColor = '#f59e0b';
    } else {
      distStatus = 'NOMINAL';
      distColor = '#00e5a3';
    }

    // 2. Isolation Hazard (Cranial Fluid Shift, ICP & Circadian Stress)
    const sleepScore = telemetry?.sleep_score ?? 90;
    const isIsoCritical = hr > 120 || sleepScore < 45 || (clinical.severity === 'CRITICAL' && primaryBioId === 'hr');
    const isIsoWatch = isIsoCritical || hr > 100 || sleepScore < 60 || isOcularAlert || (telemetry?.z_score_hr ?? 0) > 2.0 || telemetry?.scenario_phase === 'SCENARIO_18_CIRCADIAN_FATIGUE_DRIFT';
    const isoStatus: 'NOMINAL' | 'WATCH' | 'CRITICAL' = isIsoCritical ? 'CRITICAL' : isIsoWatch ? 'WATCH' : 'NOMINAL';
    const isoColor = isIsoCritical ? '#ef4444' : isIsoWatch ? '#f59e0b' : '#00e5a3';

    // 3. Radiation Hazard (Solar Particle Events & Galactic Cosmic Rays)
    const isRadCritical = radFlux > 10.0 || radDose > 0.5 || telemetry?.scenario_phase === 'SCENARIO_3_SOLAR_RADIATION_STORM' || (clinical.severity === 'CRITICAL' && primaryBioId === 'flux');
    const isRadWatch = isRadCritical || radFlux > 0.15 || radDose > 0.1 || (clinical.severity === 'WARNING' && primaryBioId === 'flux');
    const radStatus: 'NOMINAL' | 'WATCH' | 'CRITICAL' = isRadCritical ? 'CRITICAL' : isRadWatch ? 'WATCH' : 'NOMINAL';
    const radColor = isRadCritical ? '#ef4444' : isRadWatch ? '#f59e0b' : '#00e5a3';

    // 4. Environment Hazard (CO2 / SpO2 / Cabin Pressure / Toxins / Thermoregulation)
    const isEnvCritical = co2 > 4.0 || spo2 < 90.0 || temp > 38.4 || temp < 35.0 || telemetry?.scenario_phase === 'SCENARIO_2_SLOW_DECOMPRESSION_HYPOXIA' || telemetry?.scenario_phase === 'SCENARIO_4_AMMONIA_COOLANT_LEAK' || (clinical.severity === 'CRITICAL' && (primaryBioId === 'spo2' || primaryBioId === 'temp'));
    const isEnvWatch = isEnvCritical || co2 > 2.8 || spo2 < 96.5 || temp > 37.6 || temp < 35.8 || telemetry?.scenario_phase === 'SCENARIO_1_CO2_SCRUBBER_BREAKTHROUGH' || telemetry?.scenario_phase === 'SCENARIO_5_ELECTRICAL_FIRE_SMOLDER' || (clinical.severity === 'WARNING' && (primaryBioId === 'spo2' || primaryBioId === 'temp'));
    const envStatus: 'NOMINAL' | 'WATCH' | 'CRITICAL' = isEnvCritical ? 'CRITICAL' : isEnvWatch ? 'WATCH' : 'NOMINAL';
    const envColor = isEnvCritical ? '#ef4444' : isEnvWatch ? '#f59e0b' : '#00e5a3';

    // 5. Gravity Hazard (Microgravity Fluid Shift, Hemoconcentration, Thrombosis & Bone Atrophy)
    const isGravCritical = bmd < 85.0 || trm >= 2.20 || hct >= 53.0 || (primaryBioId === 'hct' && primaryBioTier === 'CRITICAL');
    const isGravWatch = isGravCritical || bmd < 90.0 || trm >= 1.40 || hct >= 48.0 || (primaryBioId === 'hct' && (primaryBioTier === 'WARNING' || primaryBioTier === 'CRITICAL')) || telemetry?.scenario_phase === 'SCENARIO_8_CARDIOVASCULAR_DECONDITIONING' || telemetry?.scenario_phase === 'SCENARIO_7_VENOUS_THROMBOSIS_RISK' || telemetry?.scenario_phase === 'SCENARIO_15_INTRAVASCULAR_DEHYDRATION';
    const gravStatus: 'NOMINAL' | 'WATCH' | 'CRITICAL' = isGravCritical ? 'CRITICAL' : isGravWatch ? 'WATCH' : 'NOMINAL';
    const gravColor = isGravCritical ? '#ef4444' : isGravWatch ? '#f59e0b' : '#00e5a3';

    return [
      {
        id: 'ISOLATION',
        title: 'Isolation',
        status: isoStatus,
        color: isoColor,
        borderColor: isoColor,
        subsystemId: 'OCULAR',
        iconType: 'BRAIN',
        side: 'LEFT',
        pos: [0.0, 1.30, 0.05],
      },
      {
        id: 'RADIATION',
        title: 'Radiation',
        status: radStatus,
        color: radColor,
        borderColor: radColor,
        subsystemId: 'RENAL',
        iconType: 'RADIATION',
        side: 'LEFT',
        pos: [-0.10, 0.18, 0.05],
      },
      {
        id: 'ENVIRONMENT',
        title: 'Environment',
        status: envStatus,
        color: envColor,
        borderColor: envColor,
        subsystemId: 'CARDIAC',
        iconType: 'ENVIRONMENT',
        side: 'RIGHT',
        pos: [-0.07, 0.72, 0.10],
      },
      {
        id: 'DISTANCE',
        title: 'Distance',
        status: distStatus,
        color: distColor,
        borderColor: distColor,
        subsystemId: 'CARDIAC',
        iconType: 'DISTANCE',
        side: 'RIGHT',
        pos: [0.18, 0.40, 0.04],
      },
      {
        id: 'GRAVITY',
        title: 'Gravity',
        status: gravStatus,
        color: gravColor,
        borderColor: gravColor,
        subsystemId: 'SKELETAL',
        iconType: 'GRAVITY',
        side: 'RIGHT',
        pos: [0.10, -0.85, 0.04],
      },
    ];
  }, [orbitalPosition, hr, spo2, hct, k, co2, temp, radFlux, radDose, trm, bmd, telemetry, isOcularAlert, clinical]);

  const dynamicHazardsRef = useRef(dynamicHazards);
  useEffect(() => {
    dynamicHazardsRef.current = dynamicHazards;
  }, [dynamicHazards]);

  // Smooth View Snap Trigger
  const snapToAngle = useCallback((targetDeg: number) => {
    const rad = (targetDeg * Math.PI) / 180;
    snapTargetAzimuthRef.current = rad;
    setAutoRotate(false);
  }, []);

  // Reset Camera View
  const handleResetCamera = useCallback(() => {
    if (controlsRef.current && cameraRef.current) {
      cameraRef.current.position.set(0, 0, 4.9);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
      snapTargetAzimuthRef.current = null;
      targetFocusYRef.current = null;
      setAutoRotate(false);
      setShowHazardModal(false);
    }
  }, []);

  // Handle Hazard Selection & Cinematic Focus
  const handleHazardClick = useCallback((hazard: typeof HAZARD_TARGETS[0]) => {
    setActiveHazard(hazard.id);
    setSelectedHotspot(hazard.subsystemId);
    setShowHazardModal(true);

    // Smooth camera elevation focus towards selected anatomical target
    const targetElevations: Record<string, number> = {
      ISOLATION: 1.05 * 0.82,
      ENVIRONMENT: 0.60 * 0.82,
      RADIATION: 0.15 * 0.82,
      DISTANCE: 0.22 * 0.82,
      GRAVITY: -0.60 * 0.82,
    };
    targetFocusYRef.current = targetElevations[hazard.id] ?? 0;

    if (onSelectSubsystem) {
      onSelectSubsystem(hazard.subsystemId);
    }
  }, [onSelectSubsystem]);

  // ─── Three.js Scene Setup (Mounts STRICTLY ONCE) ───
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 540;
    const height = container.clientHeight || 500;
    containerSizeRef.current = { width, height };

    // 1. Scene & Transparent Renderer Setup (NO solid background, shows rotating Earth video!)
    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0, 4.9);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.cursor = 'grab';

    // 2. OrbitControls with Smooth Damping
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = true;
    controls.minDistance = 3.0;
    controls.maxDistance = 7.5;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI * 0.25;
    controls.maxPolarAngle = Math.PI * 0.75;
    controls.autoRotate = autoRotateRef.current;
    controls.autoRotateSpeed = 1.8;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // 3. Ambient & Rim Lighting
    const ambientLight = new THREE.AmbientLight(0x0a2236, 1.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x00e5ff, 1.2);
    dirLight.position.set(2, 4, 3);
    scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x0088cc, 0.8);
    rimLight.position.set(-2, -1, -3);
    scene.add(rimLight);

    // ─── 4. Human Anatomical Model Group ───
    const humanGroup = new THREE.Group();
    humanGroup.scale.set(0.82, 0.82, 0.82);
    humanGroup.position.set(0, 0, 0);
    scene.add(humanGroup);

    // 4a-1. Volumetric Translucent Holographic 3D Body Mesh Surface
    // Ultra-ethereal transparency so internal skeleton, brain, arterial tree and heart shine through vividly
    const bodyGeo = new THREE.BufferGeometry();
    bodyGeo.setAttribute('position', new THREE.BufferAttribute(HUMAN_VERTICES, 3));
    bodyGeo.setIndex(new THREE.BufferAttribute(HUMAN_TRI_INDICES, 1));
    bodyGeo.computeVertexNormals();

    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x002638,
      emissive: 0x00121d,
      roughness: 0.25,
      metalness: 0.15,
      transparent: true,
      opacity: 0.11,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    humanGroup.add(bodyMesh);

    // 4a-2. Elegant Wireframe Polygon Lattice
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.BufferAttribute(HUMAN_VERTICES, 3));
    wireGeo.setIndex(new THREE.BufferAttribute(HUMAN_LINE_INDICES, 1));
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x00c8e6,
      transparent: true,
      opacity: 0.20,
    });
    const wireMesh = new THREE.LineSegments(wireGeo, wireMat);
    humanGroup.add(wireMesh);

    // 4a-3. High-Density Celestial Stardust Point Cloud (Crisp glowing outer silhouette)
    const stardustVertices = generateStardustPointCloud(HUMAN_VERTICES, HUMAN_LINE_INDICES, 4200);
    const stardustGeo = new THREE.BufferGeometry();
    stardustGeo.setAttribute('position', new THREE.BufferAttribute(stardustVertices, 3));

    const stardustMat = new THREE.PointsMaterial({
      color: 0x5ce1e6,
      size: 0.021,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const stardustMesh = new THREE.Points(stardustGeo, stardustMat);
    humanGroup.add(stardustMesh);

    // 4a-4. Authentic 3D Anatomical Internal Skeleton (Spine, Ribcage, Pelvis, Limbs, Skull)
    const skelLines = getSkeletonLineSegments();
    const skelGeo = new THREE.BufferGeometry();
    skelGeo.setAttribute('position', new THREE.BufferAttribute(skelLines, 3));

    const skelMat = new THREE.LineBasicMaterial({
      color: 0xccfbf1, // Luminous pale cyan-white bone
      transparent: true,
      opacity: 0.84,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const skelMesh = new THREE.LineSegments(skelGeo, skelMat);
    humanGroup.add(skelMesh);

    // Glowing Skeletal Joint/Disc Nodes
    const skelPts = getSkeletonPoints();
    const skelPtsGeo = new THREE.BufferGeometry();
    skelPtsGeo.setAttribute('position', new THREE.BufferAttribute(skelPts, 3));

    const skelPtsMat = new THREE.PointsMaterial({
      color: 0x5eead4,
      size: 0.016,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const skelPtsMesh = new THREE.Points(skelPtsGeo, skelPtsMat);
    humanGroup.add(skelPtsMesh);

    // 4a-5. Cranial Neural Network / Holographic Brain
    const brainNet = getBrainNeuralNetwork();
    const brainGroup = new THREE.Group();
    humanGroup.add(brainGroup);

    const brainPtsGeo = new THREE.BufferGeometry();
    brainPtsGeo.setAttribute('position', new THREE.BufferAttribute(brainNet.points, 3));

    const brainPtsMat = new THREE.PointsMaterial({
      color: 0xff1493, // Vivid deep pink/magenta neural nodes
      size: 0.025,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const brainPtsMesh = new THREE.Points(brainPtsGeo, brainPtsMat);
    brainGroup.add(brainPtsMesh);

    const brainLinesGeo = new THREE.BufferGeometry();
    brainLinesGeo.setAttribute('position', new THREE.BufferAttribute(brainNet.lines, 3));

    const brainLinesMat = new THREE.LineBasicMaterial({
      color: 0xf43f5e, // Rose pink synaptic web
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const brainLinesMesh = new THREE.LineSegments(brainLinesGeo, brainLinesMat);
    brainGroup.add(brainLinesMesh);

    // 4b. Glowing Scarlet Red Arterial / Vascular Tree (strictly nested inside body)
    const vascLines = getVascularLineSegments();
    const vascGeo = new THREE.BufferGeometry();
    vascGeo.setAttribute('position', new THREE.BufferAttribute(vascLines, 3));

    const vascMat = new THREE.LineBasicMaterial({
      color: 0xff173d,
      transparent: true,
      opacity: 0.95,
      linewidth: 2,
    });
    const vascMesh = new THREE.LineSegments(vascGeo, vascMat);
    humanGroup.add(vascMesh);

    // Glowing Red Arterial Nodes along the vessels
    const vascPts = getVascularPoints();
    const vascPtsGeo = new THREE.BufferGeometry();
    vascPtsGeo.setAttribute('position', new THREE.BufferAttribute(vascPts, 3));

    const vascPtsMat = new THREE.PointsMaterial({
      color: 0xff2a4d,
      size: 0.022,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const vascPtsMesh = new THREE.Points(vascPtsGeo, vascPtsMat);
    humanGroup.add(vascPtsMesh);

    // 4c. Pulsing Hot Pink / Magenta Myocardium Node (Vivid pink heart in left chest)
    const heartGroup = new THREE.Group();
    humanGroup.add(heartGroup);

    const heartPts = getHeartPoints();
    const heartGeo = new THREE.BufferGeometry();
    heartGeo.setAttribute('position', new THREE.BufferAttribute(heartPts, 3));

    const heartMat = new THREE.PointsMaterial({
      color: 0xff007f, // Hot pink / magenta
      size: 0.038,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const heartMesh = new THREE.Points(heartGeo, heartMat);
    heartGroup.add(heartMesh);

    // Inner glowing myocardium core
    const heartCoreGeo = new THREE.SphereGeometry(0.045, 16, 16);
    const heartCoreMat = new THREE.MeshBasicMaterial({
      color: 0xff1493,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });
    const heartCore = new THREE.Mesh(heartCoreGeo, heartCoreMat);
    heartCore.position.set(-0.07, 0.74, 0.10);
    heartGroup.add(heartCore);

    // 4d. Authentic 3D NASA Polar Target Scanner Grid Disc at floor (y = -1.78)
    const floorY = -1.78;
    const gridGroup = new THREE.Group();
    gridGroup.position.set(0, floorY, 0);
    humanGroup.add(gridGroup);

    const gridMat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.55,
    });

    // 3 Concentric Target Rings (r = 0.35, 0.70, 1.05)
    [0.35, 0.70, 1.05].forEach((radius) => {
      const ringCurve = new THREE.EllipseCurve(0, 0, radius, radius, 0, 2 * Math.PI, false, 0);
      const ringPts = ringCurve.getPoints(48);
      const rGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
      rGeo.rotateX(Math.PI / 2);
      const ringMesh = new THREE.LineLoop(rGeo, gridMat);
      gridGroup.add(ringMesh);
    });

    // 8 Radial Spokes dividing the circle at 45° intervals
    const spokesPts: number[] = [];
    const numSpokes = 8;
    const outerR = 1.05;
    for (let s = 0; s < numSpokes; s++) {
      const angle = (s / numSpokes) * Math.PI * 2;
      spokesPts.push(0, 0, 0);
      spokesPts.push(Math.sin(angle) * outerR, 0, Math.cos(angle) * outerR);
    }
    const spokesGeo = new THREE.BufferGeometry();
    spokesGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(spokesPts), 3));
    const spokesMesh = new THREE.LineSegments(spokesGeo, gridMat);
    gridGroup.add(spokesMesh);

    // Rotating Radar Scanner Sweep Arm
    const radarArmPts = new Float32Array([0, 0.002, 0, 0, 0.002, outerR]);
    const radarArmGeo = new THREE.BufferGeometry();
    radarArmGeo.setAttribute('position', new THREE.BufferAttribute(radarArmPts, 3));
    const radarArmMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.85,
    });
    const radarArmMesh = new THREE.Line(radarArmGeo, radarArmMat);
    gridGroup.add(radarArmMesh);

    // 4e. 3D Hotspot Target Reticles on the body
    const hotspot3DMeshes: THREE.Mesh[] = [];
    const hotspotRingMeshes: THREE.Mesh[] = [];

    dynamicHazardsRef.current.forEach(ht => {
      const g = new THREE.SphereGeometry(0.028, 16, 16);
      const m = new THREE.MeshBasicMaterial({ color: ht.color });
      const node = new THREE.Mesh(g, m);
      node.position.set(ht.pos[0], ht.pos[1], ht.pos[2]);
      node.userData = { id: ht.subsystemId, hazardId: ht.id };
      humanGroup.add(node);
      hotspot3DMeshes.push(node);

      // Outer targeting ring
      const rGeo = new THREE.RingGeometry(0.048, 0.062, 24);
      const rMat = new THREE.MeshBasicMaterial({
        color: ht.color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      });
      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.position.set(ht.pos[0], ht.pos[1], ht.pos[2] + 0.01);
      humanGroup.add(rMesh);
      hotspotRingMeshes.push(rMesh);
    });

    // ─── 4f. NASA EVA Suit Model Group (High-Fidelity Space EMU) ───
    const suitGroup = new THREE.Group();
    suitGroup.visible = false;
    scene.add(suitGroup);

    // Strobe / Beacon lights on EVA Suit
    const helmetBeaconLight = new THREE.PointLight(0x00e5ff, 1.2, 2.5);
    helmetBeaconLight.position.set(0, 0.88, 0.22);
    suitGroup.add(helmetBeaconLight);

    const helmetBeaconMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x00e5ff })
    );
    helmetBeaconMesh.position.set(0, 0.88, 0.22);
    suitGroup.add(helmetBeaconMesh);

    // Dual Umbilical Conduits (O2 and Liquid Cooling from PLSS to DCM Chest)
    const leftCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.22, 0.45, -0.32),
      new THREE.Vector3(-0.35, 0.32, -0.12),
      new THREE.Vector3(-0.26, 0.14, 0.20),
      new THREE.Vector3(-0.08, 0.24, 0.26),
    ]);
    const leftTubeGeo = new THREE.TubeGeometry(leftCurve, 32, 0.018, 10, false);
    const leftTubeMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x007799,
      emissiveIntensity: 0.5,
      roughness: 0.3,
      metalness: 0.7,
    });
    const leftTubeMesh = new THREE.Mesh(leftTubeGeo, leftTubeMat);
    suitGroup.add(leftTubeMesh);

    const rightCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.22, 0.45, -0.32),
      new THREE.Vector3(0.35, 0.32, -0.12),
      new THREE.Vector3(0.26, 0.14, 0.20),
      new THREE.Vector3(0.08, 0.24, 0.26),
    ]);
    const rightTubeGeo = new THREE.TubeGeometry(rightCurve, 32, 0.018, 10, false);
    const rightTubeMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.5,
      roughness: 0.3,
      metalness: 0.7,
    });
    const rightTubeMesh = new THREE.Mesh(rightTubeGeo, rightTubeMat);
    suitGroup.add(rightTubeMesh);

    const suitLoader = new GLTFLoader();
    suitLoader.load(
      '/models/Astronaut.glb',
      (gltf) => {
        const rawModel = gltf.scene;
        const suitMeshContainer = new THREE.Group();

        // Visor gold reflective material
        const visorMat = new THREE.MeshStandardMaterial({
          color: 0xffb700,
          metalness: 0.95,
          roughness: 0.12,
          emissive: 0x442800,
          emissiveIntensity: 0.4,
        });

        // NASA White Suit composite weave
        const suitMat = new THREE.MeshStandardMaterial({
          color: 0xebf2f8,
          metalness: 0.22,
          roughness: 0.65,
          emissive: 0x091420,
          emissiveIntensity: 0.25,
        });

        // Edge highlights for holographic AR definition
        const edgeLineMat = new THREE.LineBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.35,
        });

        rawModel.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const geo = mesh.geometry.clone();

            const nameLower = (mesh.name || '').toLowerCase();
            const isVisor = nameLower.includes('visor') || nameLower.includes('glass') || nameLower.includes('face');

            const renderedMesh = new THREE.Mesh(geo, isVisor ? visorMat : suitMat);
            suitMeshContainer.add(renderedMesh);

            const edgesGeo = new THREE.EdgesGeometry(geo, 25);
            const edgeLines = new THREE.LineSegments(edgesGeo, edgeLineMat);
            suitMeshContainer.add(edgeLines);
          }
        });

        const rawBox = new THREE.Box3().setFromObject(suitMeshContainer);
        const rawSize = rawBox.getSize(new THREE.Vector3());
        const targetH = 2.42;
        const scaleFactor = targetH / (rawSize.y || 1);
        suitMeshContainer.scale.set(scaleFactor * 0.88, scaleFactor, scaleFactor * 0.88);
        suitMeshContainer.updateMatrixWorld(true);

        const scaledBox = new THREE.Box3().setFromObject(suitMeshContainer);
        const center = scaledBox.getCenter(new THREE.Vector3());
        suitMeshContainer.position.set(-center.x, -center.y, -center.z);
        suitMeshContainer.updateMatrixWorld(true);

        suitGroup.add(suitMeshContainer);
      },
      undefined,
      (err) => console.warn('Could not load Astronaut.glb:', err)
    );

    switchModelRef.current = (type: 'HUMAN' | 'SUIT') => {
      modelTypeRef.current = type;
      setModelType(type);
      if (type === 'HUMAN') {
        humanGroup.visible = true;
        suitGroup.visible = false;
      } else {
        humanGroup.visible = false;
        suitGroup.visible = true;
      }
    };

    focusSuitSubsystemRef.current = (id: 'VISOR' | 'PLSS' | 'DCM' | 'SAFER' | 'TMG') => {
      const sub = suitSubsystems.find(s => s.id === id);
      if (!sub) return;
      setSelectedSuitSubsystem(id);
      targetFocusYRef.current = sub.targetY;
    };

    // ─── 5. Optional Laser Scanner Plane ───
    const scanGroup = new THREE.Group();
    scene.add(scanGroup);

    const laserBeamPts = new Float32Array([-1.1, 0, 0, 1.1, 0, 0]);
    const laserBeamGeo = new THREE.BufferGeometry();
    laserBeamGeo.setAttribute('position', new THREE.BufferAttribute(laserBeamPts, 3));
    const laserBeamMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
    });
    const laserBeamLine = new THREE.Line(laserBeamGeo, laserBeamMat);
    scanGroup.add(laserBeamLine);

    const scanSheetGeo = new THREE.PlaneGeometry(2.2, 0.28);
    scanSheetGeo.rotateX(Math.PI / 2);
    const scanSheetMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const scanSheet = new THREE.Mesh(scanSheetGeo, scanSheetMat);
    scanGroup.add(scanSheet);

    const sliceCurve = new THREE.EllipseCurve(0, 0, 1, 1, 0, 2 * Math.PI, false, 0);
    const slicePoints = sliceCurve.getPoints(48);
    const sliceGeo = new THREE.BufferGeometry().setFromPoints(slicePoints);
    sliceGeo.rotateX(Math.PI / 2);
    const sliceMat = new THREE.LineBasicMaterial({
      color: 0x80f5ff,
      transparent: true,
      opacity: 0.90,
    });
    const sliceContourLine = new THREE.LineLoop(sliceGeo, sliceMat);
    scanGroup.add(sliceContourLine);

    const scanLight = new THREE.PointLight(0x00e5ff, 2.2, 2.4);
    scanGroup.add(scanLight);

    updateMaterialsRef.current = (theme: string, severity: 'CRITICAL' | 'WARNING' | 'NOMINAL') => {
      let pColor = 0x5ce1e6;
      let vColor = 0xff173d;
      let vpColor = 0xff2a4d;
      let hColor = 0xff007f;
      let hcColor = 0xff1493;
      let baseColor = 0x00e5ff;
      let bodyCol = 0x002638;
      let bodyEmis = 0x00121d;
      let wireCol = 0x00c8e6;
      let skelColor = 0xccfbf1;
      let skelPtsColor = 0x5eead4;
      let brainColor = 0xff1493;
      let brainLineColor = 0xf43f5e;
      let radarColor = 0x00f0ff;

      if (severity === 'CRITICAL') {
        pColor = 0xff3b5c; // Vivid crimson stardust
        vColor = 0xff0033; // Emergency deep red vascular network
        vpColor = 0xff173d;
        hColor = 0xff173d; // Pulsing emergency myocardium
        hcColor = 0xcc0022;
        baseColor = 0xef4444; // Emergency red pedestal
        bodyCol = 0x3d0b14; // Alert deep crimson anatomical silhouette
        bodyEmis = 0x220509;
        wireCol = 0xff2244; // Vibrant alert red wireframe!
        skelColor = 0xff8899;
        skelPtsColor = 0xff3b5c;
        brainColor = 0xff0055;
        brainLineColor = 0xff173d;
        radarColor = 0xef4444;
      } else if (severity === 'WARNING') {
        pColor = 0xfbbf24; // Tactical amber stardust
        vColor = 0xd97706; // Amber vascular network
        vpColor = 0xf59e0b;
        hColor = 0xf59e0b; // Amber myocardium
        hcColor = 0xb45309;
        baseColor = 0xf59e0b; // Tactical amber pedestal
        bodyCol = 0x2e1e04; // Alert deep amber silhouette
        bodyEmis = 0x1a1102;
        wireCol = 0xf59e0b; // Vibrant tactical amber wireframe!
        skelColor = 0xfde68a;
        skelPtsColor = 0xfbbf24;
        brainColor = 0xf59e0b;
        brainLineColor = 0xd97706;
        radarColor = 0xf59e0b;
      } else if (theme === 'THERMAL') {
        pColor = 0xff9933; // Infrared warm orange
        vColor = 0xff3300; // Fiery crimson heat vessels
        vpColor = 0xff4500;
        hColor = 0xffffff; // Incandescent white-hot metabolic core
        hcColor = 0xff5500;
        baseColor = 0xff7700;
        bodyCol = 0x4a1800;
        bodyEmis = 0x240c00;
        wireCol = 0xff6600;
        skelColor = 0xffffff;
        skelPtsColor = 0xffeedd;
        brainColor = 0xffaa00;
        brainLineColor = 0xff5500;
        radarColor = 0xff7700;
      } else if (theme === 'AMBER') {
        pColor = 0xf59e0b; // Apollo/Orion tactical amber phosphor
        vColor = 0xd97706; // Deep gold
        vpColor = 0xfbbf24;
        hColor = 0xfbbf24; // Amber myocardium
        hcColor = 0xf59e0b;
        baseColor = 0xf59e0b;
        bodyCol = 0x3d2800;
        bodyEmis = 0x1f1400;
        wireCol = 0xf59e0b;
        skelColor = 0xfde68a;
        skelPtsColor = 0xfbbf24;
        brainColor = 0xf59e0b;
        brainLineColor = 0xd97706;
        radarColor = 0xf59e0b;
      }

      bodyMat.color.setHex(bodyCol);
      bodyMat.emissive.setHex(bodyEmis);
      wireMat.color.setHex(wireCol);
      stardustMat.color.setHex(pColor);
      skelMat.color.setHex(skelColor);
      skelPtsMat.color.setHex(skelPtsColor);
      brainPtsMat.color.setHex(brainColor);
      brainLinesMat.color.setHex(brainLineColor);
      vascMat.color.setHex(vColor);
      vascPtsMat.color.setHex(vpColor);
      heartMat.color.setHex(hColor);
      heartCoreMat.color.setHex(hcColor);
      gridMat.color.setHex(baseColor);
      radarArmMat.color.setHex(radarColor);
      scanSheetMat.color.setHex(pColor);
      sliceMat.color.setHex(pColor);
      scanLight.color.setHex(severity === 'CRITICAL' ? 0xff173d : severity === 'WARNING' ? 0xf59e0b : pColor);
    };

    // Apply initial materials on mount
    updateMaterialsRef.current(colorTheme, activeSeverityRef.current);

    // ─── 6. Pointer & Raycasting Event Handling ───
    const raycaster = new THREE.Raycaster();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
      renderer.domElement.style.cursor = 'grabbing';
      snapTargetAzimuthRef.current = null;
    };

    const onPointerUp = (e: PointerEvent) => {
      renderer.domElement.style.cursor = 'grab';

      const dx = Math.abs(e.clientX - pointerDownPos.x);
      const dy = Math.abs(e.clientY - pointerDownPos.y);

      if (dx < 5 && dy < 5) {
        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(hotspot3DMeshes);
        if (intersects.length > 0) {
          const hitId = intersects[0].object.userData.id as 'OCULAR' | 'CARDIAC' | 'RENAL' | 'SKELETAL';
          const hazardId = intersects[0].object.userData.hazardId as string;
          setSelectedHotspot(hitId);
          setActiveHazard(hazardId);
          if (onSelectSubsystemRef.current) onSelectSubsystemRef.current(hitId);
        }
      }
    };

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointerup', onPointerUp);

    // ─── 7. Animation Loop (60 FPS Tracking & Pulsing) ───
    let animationFrameId: number;
    const clock = new THREE.Clock();
    let currentScanY = 0;
    let targetScanY = 0;

    const getRegionName = (y: number): string => {
      if (y > 1.10) return 'CRANIAL / ISOLATION';
      if (y > 0.75) return 'THORACIC / ENVIRONMENT';
      if (y > 0.40) return 'CARDIAC / MYOCARDIUM';
      if (y > 0.05) return 'ABDOMINAL / RADIATION';
      if (y > -0.30) return 'PELVIC / DISTANCE';
      if (y > -0.85) return 'FEMORAL / GRAVITY';
      if (y > -1.25) return 'TIBIAL / LOWER PERIPHERY';
      return 'PLANTAR / BASE';
    };

    const tempVec = new THREE.Vector3();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      // Handle smooth view snap animation
      if (snapTargetAzimuthRef.current !== null) {
        const currentAz = controls.getAzimuthalAngle();
        const diff = snapTargetAzimuthRef.current - currentAz;
        if (Math.abs(diff) > 0.02) {
          controls.autoRotate = false;
          const step = diff * 0.12;
          camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), step);
        } else {
          snapTargetAzimuthRef.current = null;
        }
      }

      controls.update();

      // Handle smooth vertical focus pan animation
      if (targetFocusYRef.current !== null) {
        const curY = controls.target.y;
        const diffY = targetFocusYRef.current - curY;
        if (Math.abs(diffY) > 0.005) {
          controls.target.y += diffY * 0.08;
        }
      }

      // Azimuth HUD text
      if (azimuthDomRef.current) {
        const rawAz = controls.getAzimuthalAngle();
        const deg = Math.round((((rawAz % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2)) * 360);
        azimuthDomRef.current.textContent = `${deg}°`;
      }

      // Laser Scanner Plane
      const mode = laserModeRef.current;
      if (mode === 'OFF') {
        scanGroup.visible = false;
      } else {
        scanGroup.visible = true;
        if (mode === 'SWEEP') {
          const cycle = (Math.sin(elapsed * 1.25) + 1) * 0.5;
          targetScanY = -1.60 + cycle * (1.35 - (-1.60));
          currentScanY += (targetScanY - currentScanY) * 0.15;
        } else if (mode === 'LOCK_ORGAN') {
          const activeHs = hotspots.find(h => h.id === selectedHotspotRef.current);
          targetScanY = activeHs ? activeHs.scanTargetY : 0.70;
          currentScanY += (targetScanY - currentScanY) * 0.10;
        }

        scanGroup.position.y = currentScanY;
        const contour = getBodyContourRadii(currentScanY);
        sliceContourLine.scale.set(contour.rx * 1.08, 1, contour.rz * 1.08);
        scanSheetMat.opacity = 0.20 + 0.08 * Math.sin(elapsed * 4.0);

        if (elevationDomRef.current) {
          elevationDomRef.current.textContent = `${currentScanY >= 0 ? '+' : ''}${currentScanY.toFixed(2)} m`;
        }
        if (regionDomRef.current) {
          regionDomRef.current.textContent = getRegionName(currentScanY);
        }
        if (sliceIndexDomRef.current) {
          const sliceNum = Math.round(((currentScanY + 1.60) / 2.95) * 128);
          sliceIndexDomRef.current.textContent = `SLICE #${Math.max(1, Math.min(128, sliceNum))}`;
        }
        if (elevationRulerChevronRef.current) {
          const pct = Math.max(0, Math.min(100, ((currentScanY + 1.60) / 2.95) * 100));
          elevationRulerChevronRef.current.style.bottom = `${pct}%`;
        }
      }

      // ─── Real-Time Floor Radar Sweep Rotation ───
      radarArmMesh.rotation.y = elapsed * 1.5;

      // ─── Real-Time Brainwave Synaptic Pulsation ───
      const brainPulse = 1.0 + 0.045 * Math.sin(elapsed * 2.8);
      brainGroup.scale.set(brainPulse, brainPulse, brainPulse);

      // ─── Real-Time Double-Beat Pulsing Heart ───
      const currentHr = hrRef.current || 72;
      const bps = (currentHr / 60) * Math.PI * 2;
      const pulseScale = 1.0 + 0.26 * Math.pow(Math.sin(elapsed * bps), 4);
      heartGroup.scale.set(pulseScale, pulseScale, pulseScale);

      // ─── Real-Time Microgravity EVA Spacesuit Floating & Strobe Animation ───
      if (modelTypeRef.current === 'SUIT') {
        suitGroup.position.y = Math.sin(elapsed * 1.25) * 0.035;
        suitGroup.rotation.z = Math.sin(elapsed * 0.65) * 0.016;
        suitGroup.rotation.x = Math.sin(elapsed * 0.85) * 0.012;

        const beaconPulse = 0.5 + 0.5 * Math.sin(elapsed * 3.5);
        helmetBeaconLight.intensity = 0.6 + 1.2 * beaconPulse;
        helmetBeaconMesh.scale.setScalar(0.9 + 0.3 * beaconPulse);
      }

      // ─── Real-Time 3D Mesh Color Updates & Pulse from dynamicHazardsRef ───
      dynamicHazardsRef.current.forEach((ht, i) => {
        if (hotspot3DMeshes[i]) {
          (hotspot3DMeshes[i].material as THREE.MeshBasicMaterial).color.set(ht.color);
        }
        if (hotspotRingMeshes[i]) {
          (hotspotRingMeshes[i].material as THREE.MeshBasicMaterial).color.set(ht.color);
          if (ht.status === 'CRITICAL') {
            hotspotRingMeshes[i].scale.setScalar(1.0 + 0.35 * Math.sin(elapsed * 6.0));
          } else if (ht.status === 'WATCH') {
            hotspotRingMeshes[i].scale.setScalar(1.0 + 0.22 * Math.sin(elapsed * 4.0));
          } else {
            hotspotRingMeshes[i].scale.setScalar(1.0);
          }
        }
      });

      // Subtle breathing pulse on the 3D wireframe during alert states for prominent tactile feedback
      const curSev = activeSeverityRef.current;
      if (curSev === 'CRITICAL') {
        wireMat.opacity = 0.50 + 0.38 * Math.sin(elapsed * 5.0);
        scanLight.intensity = 2.4 + 1.0 * Math.sin(elapsed * 5.0);
      } else if (curSev === 'WARNING') {
        wireMat.opacity = 0.52 + 0.26 * Math.sin(elapsed * 3.5);
        scanLight.intensity = 2.0 + 0.7 * Math.sin(elapsed * 3.5);
      } else {
        wireMat.opacity = 0.55;
        scanLight.intensity = 2.2;
      }

      // ─── Project 3D Hotspot Targets to 2D Screen for Dotted Leader Lines ───
      const curW = containerSizeRef.current.width;
      const curH = containerSizeRef.current.height;

      dynamicHazardsRef.current.forEach(ht => {
        tempVec.set(ht.pos[0], ht.pos[1], ht.pos[2]);
        tempVec.applyMatrix4(humanGroup.matrixWorld);
        tempVec.project(camera);

        const screenX = ((tempVec.x + 1) / 2) * curW;
        const screenY = ((-tempVec.y + 1) / 2) * curH;

        // Position 2D Hotspot Reticle Ring
        const ringEl = ringRefs.current[ht.id];
        if (ringEl) {
          ringEl.style.transform = `translate(${screenX - 12}px, ${screenY - 12}px)`;
          ringEl.style.borderColor = ht.color;
          ringEl.style.boxShadow = `0 0 12px ${ht.color}`;
          const innerDot = ringEl.firstElementChild as HTMLElement;
          if (innerDot) {
            innerDot.style.background = ht.color;
            innerDot.style.boxShadow = `0 0 8px ${ht.color}`;
          }
        }

        // Draw Dotted Leader Line from Badge to Hotspot
        const lineEl = lineRefs.current[ht.id];
        if (lineEl) {
          const badgeAnchorX = ht.side === 'LEFT' ? 168 : curW - 168;
          let badgeAnchorY = curH * 0.5;

          if (ht.id === 'ISOLATION') badgeAnchorY = curH * 0.10 + 20;
          else if (ht.id === 'ENVIRONMENT') badgeAnchorY = curH * 0.16 + 20;
          else if (ht.id === 'RADIATION') badgeAnchorY = curH * 0.46 + 20;
          else if (ht.id === 'DISTANCE') badgeAnchorY = curH * 0.44 + 20;
          else if (ht.id === 'GRAVITY') badgeAnchorY = curH * 0.74 + 20;

          lineEl.setAttribute('x1', String(badgeAnchorX));
          lineEl.setAttribute('y1', String(badgeAnchorY));
          lineEl.setAttribute('x2', String(screenX));
          lineEl.setAttribute('y2', String(screenY));
          lineEl.setAttribute('stroke', ht.color);
        }
      });

      renderer.render(scene, camera);
    };

    animate();

    // ─── Responsive ResizeObserver ───
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0 && h > 0) {
          containerSizeRef.current = { width: w, height: h };
          camera.aspect = w / h;
          if (w < 460) {
            camera.position.z = 5.2;
          } else if (w < 600) {
            camera.position.z = 4.8;
          } else {
            camera.position.z = 4.6;
          }
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationFrameId);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointerup', onPointerUp);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container && dom) {
        container.removeChild(dom);
      }
    };
  }, []);

  // Icon Helper for Badges
  const renderHazardIcon = (type: HazardTarget['iconType'], color: string) => {
    switch (type) {
      case 'BRAIN':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04" />
            <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04" />
          </svg>
        );
      case 'RADIATION':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="2.5" />
            <path d="M12 2a4 4 0 0 1 4 4c0 1.2-.5 2.3-1.4 3" />
            <path d="M7.5 19.8A4 4 0 0 1 6 16c0-1.2.5-2.3 1.4-3" />
            <path d="M20.5 16a4 4 0 0 1-3.5 3.8c-1.2 0-2.3-.5-3-1.4" />
            <circle cx="12" cy="12" r="9" strokeDasharray="3 3" opacity="0.4" />
          </svg>
        );
      case 'ENVIRONMENT':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
            <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
            <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
          </svg>
        );
      case 'DISTANCE':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 7 9 3 5 7l4 4" />
            <path d="m17 11 4 4-4 4-4-4" />
            <path d="m8 12 4 4 6-6-4-4Z" />
            <path d="m16 8 3-3" />
            <path d="M9 21a6 6 0 0 0-6-6" />
          </svg>
        );
      case 'GRAVITY':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6.5 6.5 11 11" />
            <path d="m21 21-1-1a2 2 0 0 0-2.83 0l-.88.88a2 2 0 0 1-2.83 0L12 19.41" />
            <path d="M3 3l1 1a2 2 0 0 0 2.83 0l.88-.88a2 2 0 0 1 2.83 0L12 4.59" />
            <path d="m16 19 3-3" />
            <path d="m5 8 3-3" />
          </svg>
        );
    }
  };

  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(12, 19, 32, 0.60) 0%, rgba(6, 10, 18, 0.72) 100%)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: 16,
      overflow: 'hidden',
      position: 'relative',
      fontFamily: "var(--hud-font-sans, 'Tomorrow', -apple-system, BlinkMacSystemFont, sans-serif)",
      boxShadow: '0 12px 36px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    }}>
      {/* ─── Top Technical Header Strip ─── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
        background: 'rgba(7, 12, 22, 0.75)',
        backdropFilter: 'blur(16px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#ffffff', letterSpacing: '0.02em' }}>
            {crewNo} · {astronautName.toUpperCase()}
          </span>
        </div>

        {/* Operational Controls: Model Selector, Sensor Themes & View Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* 3D Model Mode: Body vs Spacesuit */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.55)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 7,
              padding: 2,
              gap: 2,
            }}
          >
            <button
              onClick={() => switchModelRef.current && switchModelRef.current('HUMAN')}
              style={{
                background: modelType === 'HUMAN' ? 'rgba(56, 189, 248, 0.24)' : 'transparent',
                border: modelType === 'HUMAN' ? '1px solid #38bdf8' : '1px solid transparent',
                color: modelType === 'HUMAN' ? '#38bdf8' : '#94a3b8',
                borderRadius: 5,
                padding: '4px 9px',
                fontSize: 10,
                fontWeight: modelType === 'HUMAN' ? 700 : 500,
                fontFamily: 'monospace',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                transition: 'all 0.14s ease',
              }}
            >
              <User size={12} />
              <span>3D Body</span>
            </button>
            <button
              onClick={() => switchModelRef.current && switchModelRef.current('SUIT')}
              style={{
                background: modelType === 'SUIT' ? 'rgba(56, 189, 248, 0.24)' : 'transparent',
                border: modelType === 'SUIT' ? '1px solid #38bdf8' : '1px solid transparent',
                color: modelType === 'SUIT' ? '#38bdf8' : '#94a3b8',
                borderRadius: 5,
                padding: '4px 9px',
                fontSize: 10,
                fontWeight: modelType === 'SUIT' ? 700 : 500,
                fontFamily: 'monospace',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                transition: 'all 0.14s ease',
              }}
            >
              <Shield size={12} />
              <span>EVA Suit</span>
            </button>
          </div>

          <span style={{ width: 1, height: 18, background: 'rgba(255, 255, 255, 0.12)' }} />

          {/* ── SENSOR THEME MODE SELECTOR (CYAN, THERMAL, AMBER) ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.55)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 7,
              padding: 2,
              gap: 2,
            }}
          >
            {[
              {
                id: 'CYAN' as const,
                label: 'CYAN',
                sub: 'Bio-Holo',
                title: 'Holographic Bio-Scanner: Cyan stardust point cloud & arterial network for structural anatomy and cephalic fluid shift tracking (NASA-STD-3001).',
                accent: '#00e5ff',
                icon: Activity,
              },
              {
                id: 'THERMAL' as const,
                label: 'THERMAL',
                sub: 'IR Heatmap',
                title: 'Infrared Biomedical Thermography: Visualizes metabolic core heat accumulation, EVA exertion dissipation, and thermal strain gradients.',
                accent: '#ff8833',
                icon: Flame,
              },
              {
                id: 'AMBER' as const,
                label: 'AMBER',
                sub: 'Tactical HUD',
                title: 'Tactical Flight HUD: Apollo/Orion high-contrast amber phosphor mode for high-vibration flight phases and urgent physiological anomaly sentry.',
                accent: '#f59e0b',
                icon: Sun,
              },
            ].map(t => {
              const active = colorTheme === t.id;
              const IconComponent = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setColorTheme(t.id)}
                  title={t.title}
                  style={{
                    background: active ? `${t.accent}2c` : 'transparent',
                    border: active ? `1px solid ${t.accent}` : '1px solid transparent',
                    color: active ? t.accent : '#94a3b8',
                    borderRadius: 5,
                    padding: '4px 9px',
                    fontSize: 10,
                    fontWeight: active ? 700 : 500,
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    boxShadow: active ? `0 0 10px ${t.accent}40` : 'none',
                    transition: 'all 0.14s ease',
                  }}
                >
                  <IconComponent size={12} color={active ? t.accent : '#94a3b8'} />
                  <span>{t.label}</span>
                  <span style={{ fontSize: 8.5, opacity: active ? 0.95 : 0.6 }}>
                    ({t.sub})
                  </span>
                </button>
              );
            })}
          </div>

          <span style={{ width: 1, height: 18, background: 'rgba(255, 255, 255, 0.12)' }} />

          {/* Layout Toggle: Split vs Full 3D Focus */}
          <button
            onClick={() => setViewMode(prev => prev === 'SPLIT' ? 'FULL' : 'SPLIT')}
            title="Toggle between full 3D view and split telemetry inspection"
            style={{
              background: viewMode === 'FULL' ? 'rgba(0, 229, 255, 0.22)' : 'rgba(255, 255, 255, 0.06)',
              border: viewMode === 'FULL' ? '1px solid #00e5ff' : '1px solid rgba(255, 255, 255, 0.12)',
              color: viewMode === 'FULL' ? '#00e5ff' : '#cbd5e1',
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'monospace',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              transition: 'all 0.14s ease',
            }}
          >
            {viewMode === 'FULL' ? (
              <>
                <Columns2 size={12} />
                <span>Split Telemetry</span>
              </>
            ) : (
              <>
                <Maximize2 size={12} />
                <span>Full 3D View</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ─── Main 3D Viewport & Inspection Split Card (Height 580px) ─── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: viewMode === 'FULL' ? '1fr' : 'minmax(460px, 1fr) 330px',
        height: 580,
        maxHeight: 580,
        position: 'relative',
      }}>
        {/* Left: 3D Holographic Canvas Viewport (100% Transparent to show rotating Earth video!) */}
        <div style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          background: 'transparent',
        }}>
          {/* WebGL Canvas Container */}
          <div ref={mountRef} style={{ width: '100%', height: '100%', background: 'transparent' }} />

          {/* ── SVG OVERLAY FOR DOTTED LEADER LINES ── */}
          <svg
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            {dynamicHazards.map(ht => (
              <line
                key={ht.id}
                ref={el => { lineRefs.current[ht.id] = el; }}
                x1="0"
                y1="0"
                x2="0"
                y2="0"
                stroke={ht.color}
                strokeWidth="1.2"
                strokeDasharray="3 3"
                opacity={activeHazard === ht.id ? 0.95 : 0.45}
              />
            ))}
          </svg>

          {/* ── 2D HOTSPOT RETICLE RINGS ON BODY (TRACKED AT 60 FPS) ── */}
          {dynamicHazards.map(ht => (
            <div
              key={ht.id}
              ref={el => { ringRefs.current[ht.id] = el; }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: `1.5px solid ${ht.color}`,
                boxShadow: `0 0 10px ${ht.color}66`,
                pointerEvents: 'none',
                zIndex: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: 'translate(-999px, -999px)',
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: ht.color,
                  boxShadow: `0 0 6px ${ht.color}`,
                }}
              />
            </div>
          ))}

          {/* ── LEFT BADGES: ISOLATION & RADIATION (Sleek Glassmorphic Enterprise HUD) ── */}
          {/* 1. Isolation (Top Left) */}
          <div
            onClick={() => handleHazardClick(dynamicHazards[0])}
            style={{
              position: 'absolute',
              top: '10%',
              left: 10,
              cursor: 'pointer',
              zIndex: 20,
              transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              transform: activeHazard === 'ISOLATION' ? 'scale(1.03)' : 'scale(1)',
              background: activeHazard === 'ISOLATION' ? 'rgba(7, 18, 28, 0.94)' : 'rgba(8, 14, 22, 0.84)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: `1px solid ${activeHazard === 'ISOLATION' ? dynamicHazards[0].color : `${dynamicHazards[0].color}55`}`,
              borderRadius: 10,
              padding: '6px 10px',
              boxShadow: activeHazard === 'ISOLATION'
                ? `0 0 18px ${dynamicHazards[0].color}44, 0 4px 16px rgba(0,0,0,0.6)`
                : '0 4px 16px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 155,
            }}
          >
            <div style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: `${dynamicHazards[0].color}16`,
              border: `1px solid ${dynamicHazards[0].color}44`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              {renderHazardIcon('BRAIN', dynamicHazards[0].color)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#f1f5f9', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                  Isolation
                </span>
                <span style={{
                  fontSize: 8,
                  fontWeight: 700,
                  color: dynamicHazards[0].color,
                  background: `${dynamicHazards[0].color}18`,
                  padding: '1px 5px',
                  borderRadius: 3,
                  letterSpacing: '0.04em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                }}>
                  {dynamicHazards[0].status === 'NOMINAL' ? (
                    <CheckCircle2 size={8} color={dynamicHazards[0].color} />
                  ) : (
                    <AlertTriangle size={8} color={dynamicHazards[0].color} />
                  )}
                  <span>{dynamicHazards[0].status}</span>
                </span>
              </div>
              <span style={{ fontSize: 9.5, color: '#94a3b8', fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>
                ONSD {(5.1 + ((hr - 60) * 0.01)).toFixed(1)} mm
              </span>
            </div>
          </div>

          {/* 2. Radiation (Mid Left) */}
          <div
            onClick={() => handleHazardClick(dynamicHazards[1])}
            style={{
              position: 'absolute',
              top: '46%',
              left: 10,
              cursor: 'pointer',
              zIndex: 20,
              transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              transform: activeHazard === 'RADIATION' ? 'scale(1.03)' : 'scale(1)',
              background: activeHazard === 'RADIATION' ? 'rgba(7, 18, 28, 0.94)' : 'rgba(8, 14, 22, 0.84)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: `1px solid ${activeHazard === 'RADIATION' ? dynamicHazards[1].color : `${dynamicHazards[1].color}55`}`,
              borderRadius: 10,
              padding: '6px 10px',
              boxShadow: activeHazard === 'RADIATION'
                ? `0 0 18px ${dynamicHazards[1].color}44, 0 4px 16px rgba(0,0,0,0.6)`
                : '0 4px 16px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 155,
            }}
          >
            <div style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: `${dynamicHazards[1].color}16`,
              border: `1px solid ${dynamicHazards[1].color}44`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              {renderHazardIcon('RADIATION', dynamicHazards[1].color)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#f1f5f9', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                  Radiation
                </span>
                <span style={{
                  fontSize: 8,
                  fontWeight: 700,
                  color: dynamicHazards[1].color,
                  background: `${dynamicHazards[1].color}18`,
                  padding: '1px 5px',
                  borderRadius: 3,
                  letterSpacing: '0.04em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                }}>
                  {dynamicHazards[1].status === 'NOMINAL' ? (
                    <CheckCircle2 size={8} color={dynamicHazards[1].color} />
                  ) : (
                    <AlertTriangle size={8} color={dynamicHazards[1].color} />
                  )}
                  <span>{dynamicHazards[1].status}</span>
                </span>
              </div>
              <span style={{ fontSize: 9.5, color: '#94a3b8', fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {(telemetry?.radiation_flux ?? 0.04).toFixed(2)} mSv/h
              </span>
            </div>
          </div>

          {/* ── RIGHT BADGES: ENVIRONMENT, DISTANCE & GRAVITY (Sleek Glassmorphic Enterprise HUD) ── */}
          {/* 3. Environment (Top Right) */}
          <div
            onClick={() => handleHazardClick(dynamicHazards[2])}
            style={{
              position: 'absolute',
              top: '16%',
              right: 10,
              cursor: 'pointer',
              zIndex: 20,
              transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              transform: activeHazard === 'ENVIRONMENT' ? 'scale(1.03)' : 'scale(1)',
              background: activeHazard === 'ENVIRONMENT' ? 'rgba(7, 18, 28, 0.94)' : 'rgba(8, 14, 22, 0.84)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: `1px solid ${activeHazard === 'ENVIRONMENT' ? dynamicHazards[2].color : `${dynamicHazards[2].color}55`}`,
              borderRadius: 10,
              padding: '6px 10px',
              boxShadow: activeHazard === 'ENVIRONMENT'
                ? `0 0 18px ${dynamicHazards[2].color}44, 0 4px 16px rgba(0,0,0,0.6)`
                : '0 4px 16px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 155,
            }}
          >
            <div style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: `${dynamicHazards[2].color}16`,
              border: `1px solid ${dynamicHazards[2].color}44`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              {renderHazardIcon('ENVIRONMENT', dynamicHazards[2].color)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#f1f5f9', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                  Environment
                </span>
                <span style={{
                  fontSize: 8,
                  fontWeight: 700,
                  color: dynamicHazards[2].color,
                  background: `${dynamicHazards[2].color}18`,
                  padding: '1px 5px',
                  borderRadius: 3,
                  letterSpacing: '0.04em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                }}>
                  {dynamicHazards[2].status === 'NOMINAL' ? (
                    <CheckCircle2 size={8} color={dynamicHazards[2].color} />
                  ) : (
                    <AlertTriangle size={8} color={dynamicHazards[2].color} />
                  )}
                  <span>{dynamicHazards[2].status}</span>
                </span>
              </div>
              <span style={{ fontSize: 9.5, color: '#94a3b8', fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {modelType === 'SUIT' ? 'Suit 29.6 kPa' : `CO₂ ${(telemetry?.cabin_co2 ?? 1.82).toFixed(1)} mmHg`}
              </span>
            </div>
          </div>

          {/* 4. Distance (Mid Right - Real-Time Orbital Telemetry & Latency) */}
          <div
            onClick={() => handleHazardClick(dynamicHazards[3])}
            style={{
              position: 'absolute',
              top: '34%',
              right: 10,
              cursor: 'pointer',
              zIndex: 20,
              transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              transform: activeHazard === 'DISTANCE' ? 'scale(1.03)' : 'scale(1)',
              background: activeHazard === 'DISTANCE' ? 'rgba(7, 18, 28, 0.94)' : 'rgba(8, 14, 22, 0.84)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: `1px solid ${activeHazard === 'DISTANCE' ? dynamicHazards[3].color : `${dynamicHazards[3].color}55`}`,
              borderRadius: 10,
              padding: '6px 10px',
              boxShadow: activeHazard === 'DISTANCE'
                ? `0 0 18px ${dynamicHazards[3].color}44, 0 4px 16px rgba(0,0,0,0.6)`
                : '0 4px 16px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 155,
            }}
          >
            <div style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: `${dynamicHazards[3].color}16`,
              border: `1px solid ${dynamicHazards[3].color}44`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              {renderHazardIcon('DISTANCE', dynamicHazards[3].color)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#f1f5f9', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                  Distance
                </span>
                <span style={{
                  fontSize: 8,
                  fontWeight: 700,
                  color: dynamicHazards[3].color,
                  background: `${dynamicHazards[3].color}18`,
                  padding: '1px 5px',
                  borderRadius: 3,
                  letterSpacing: '0.04em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                }}>
                  {dynamicHazards[3].status === 'NOMINAL' ? (
                    <CheckCircle2 size={8} color={dynamicHazards[3].color} />
                  ) : (
                    <AlertTriangle size={8} color={dynamicHazards[3].color} />
                  )}
                  <span>{dynamicHazards[3].status}</span>
                </span>
              </div>
              <span style={{ fontSize: 9.5, color: dynamicHazards[3].color, fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>
                Latency {fmtTime(DISTANCES[orbitalPosition || 'LEO']?.delaySec ?? 0)}
              </span>
            </div>
          </div>

          {/* 5. Gravity (Bottom Right) */}
          <div
            onClick={() => handleHazardClick(dynamicHazards[4])}
            style={{
              position: 'absolute',
              top: '56%',
              right: 10,
              cursor: 'pointer',
              zIndex: 20,
              transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              transform: activeHazard === 'GRAVITY' ? 'scale(1.03)' : 'scale(1)',
              background: activeHazard === 'GRAVITY' ? 'rgba(7, 18, 28, 0.94)' : 'rgba(8, 14, 22, 0.84)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: `1px solid ${activeHazard === 'GRAVITY' ? dynamicHazards[4].color : `${dynamicHazards[4].color}55`}`,
              borderRadius: 10,
              padding: '6px 10px',
              boxShadow: activeHazard === 'GRAVITY'
                ? `0 0 18px ${dynamicHazards[4].color}44, 0 4px 16px rgba(0,0,0,0.6)`
                : '0 4px 16px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 155,
            }}
          >
            <div style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: `${dynamicHazards[4].color}16`,
              border: `1px solid ${dynamicHazards[4].color}44`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              {renderHazardIcon('GRAVITY', dynamicHazards[4].color)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#f1f5f9', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                  Gravity
                </span>
                <span style={{
                  fontSize: 8,
                  fontWeight: 700,
                  color: dynamicHazards[4].color,
                  background: `${dynamicHazards[4].color}18`,
                  padding: '1px 5px',
                  borderRadius: 3,
                  letterSpacing: '0.04em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                }}>
                  {dynamicHazards[4].status === 'NOMINAL' ? (
                    <CheckCircle2 size={8} color={dynamicHazards[4].color} />
                  ) : (
                    <AlertTriangle size={8} color={dynamicHazards[4].color} />
                  )}
                  <span>{dynamicHazards[4].status}</span>
                </span>
              </div>
              <span style={{
                fontSize: 9.5,
                color: dynamicHazards[4].status !== 'NOMINAL' ? dynamicHazards[4].color : '#94a3b8',
                fontFamily: 'monospace',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>
                {primaryBioId === 'hct' || hct > 48.0
                  ? `Hct ${hct.toFixed(1)}% · Hemoconc`
                  : trm > 1.40
                    ? `TRM ${trm.toFixed(2)} · Stasis`
                    : `BMD ${bmd.toFixed(1)}%`}
              </span>
            </div>
          </div>

          {/* ── INTERACTIVE FLOATING HUD DETAIL CARD ON 3D VIEWPORT ── */}
          {activeHazard && showHazardModal && (() => {
            const hazardItem = dynamicHazards.find(h => h.id === activeHazard);
            const activeHs = hotspots.find(h => h.id === hazardItem?.subsystemId) || hotspots[0];
            const hazardColor = hazardItem?.color || '#00e5ff';

            return (
              <div
                style={{
                  position: 'absolute',
                  bottom: 14,
                  left: 14,
                  right: 14,
                  maxWidth: 440,
                  background: 'rgba(7, 12, 20, 0.92)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  border: `1.5px solid ${hazardColor}`,
                  boxShadow: `0 8px 32px rgba(0,0,0,0.8), 0 0 24px ${hazardColor}44`,
                  borderRadius: 14,
                  padding: '12px 16px',
                  zIndex: 25,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: hazardColor,
                      boxShadow: `0 0 8px ${hazardColor}`,
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#ffffff', letterSpacing: '0.04em' }}>
                      NASA HAZARD: {hazardItem?.title.toUpperCase()}
                    </span>
                    <span style={{
                      fontSize: 9,
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: hazardColor,
                      background: `${hazardColor}20`,
                      padding: '2px 7px',
                      borderRadius: 3,
                      border: `1px solid ${hazardColor}50`,
                    }}>
                      {hazardItem?.status}
                    </span>
                  </div>
                  <button
                    onClick={() => setShowHazardModal(false)}
                    title="Close detail HUD"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      padding: '2px',
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Subsystem & Region */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#7dd3fc', fontFamily: 'monospace', marginBottom: 4 }}>
                  <span>SUBSYSTEM: {activeHs.subsystemName}</span>
                  <span>·</span>
                  <span>{activeHs.elevationTag}</span>
                </div>

                {/* Live Metric */}
                <div style={{
                  fontSize: 12,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: activeHs.severity === 'CRITICAL' ? '#fca5a5' : activeHs.severity === 'WARNING' ? '#fde047' : '#e0f2fe',
                  marginBottom: 4,
                }}>
                  {activeHs.metric}
                </div>

                {/* Clinical Detail */}
                <div style={{ fontSize: 10, color: '#cbd5e1', lineHeight: 1.35, marginBottom: 8 }}>
                  {activeHs.detail}
                </div>

                {/* Protocol Action Line */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'rgba(0, 0, 0, 0.55)',
                  borderRadius: 6,
                  padding: '6px 10px',
                  borderLeft: `3px solid ${hazardColor}`,
                }}>
                  <span style={{ fontSize: 9, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '75%' }}>
                    <strong style={{ color: hazardColor }}>RX:</strong> {activeHs.protocol}
                  </span>
                  <button
                    onClick={() => {
                      if (hazardItem) handleHazardClick(hazardItem);
                    }}
                    style={{
                      background: `${hazardColor}26`,
                      border: `1px solid ${hazardColor}`,
                      borderRadius: 4,
                      padding: '3px 8px',
                      fontSize: 9,
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      color: hazardColor,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Crosshair size={10} />
                    <span>FOCUS</span>
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Tactical Viewport Overlays (Top Left) */}
          <div style={{
            position: 'absolute',
            top: 10,
            left: 12,
            pointerEvents: 'none',
            fontSize: 9,
            fontFamily: 'monospace',
            color: '#8cb3d9',
            lineHeight: 1.35,
            zIndex: 15,
          }}>
            <div style={{ color: '#00e5ff', fontWeight: 700 }}>
              ELEV: <span ref={elevationDomRef} style={{ color: '#ffffff', fontWeight: 700 }}>+0.70 m</span> · <span ref={sliceIndexDomRef} style={{ color: '#00e5ff' }}>#64</span>
            </div>
            <div>
              REGION: <span ref={regionDomRef} style={{ color: '#b5d5f5' }}>THORACIC</span> · AZ: <span ref={azimuthDomRef} style={{ color: '#ffffff', fontWeight: 700 }}>0°</span>
            </div>
          </div>

          {/* Tactical Viewport Overlays (Top Right) */}
          <div style={{
            position: 'absolute',
            top: 10,
            right: 12,
            pointerEvents: 'none',
            fontSize: 9,
            fontFamily: 'monospace',
            textAlign: 'right',
            color: '#8cb3d9',
            lineHeight: 1.35,
            zIndex: 15,
          }}>
            <div>NASA HRP: 5/5 MONITORED</div>
            <div style={{
              color: dynamicHazards.some(h => h.status === 'CRITICAL') || activeSeverity === 'CRITICAL'
                ? '#ef4444'
                : dynamicHazards.some(h => h.status === 'WATCH') || activeSeverity === 'WARNING'
                  ? '#f59e0b'
                  : '#00e5a3',
              fontWeight: 700,
            }}>
              {dynamicHazards.some(h => h.status === 'CRITICAL') || activeSeverity === 'CRITICAL'
                ? 'CRITICAL HAZARD DETECTED'
                : dynamicHazards.some(h => h.status === 'WATCH') || activeSeverity === 'WARNING'
                  ? (clinical.primaryConcern ? `HAZARD: ${clinical.primaryConcern.title}` : 'HAZARD CAUTION (MONITORED)')
                  : 'ALL HAZARDS: NOMINAL'}
            </div>
          </div>

          {/* Interactive Hint at Bottom Left */}
          <div style={{
            position: 'absolute',
            bottom: 8,
            left: 12,
            pointerEvents: 'none',
            fontSize: 9,
            color: '#7295b8',
            fontFamily: 'monospace',
            zIndex: 15,
          }}>
            {modelType === 'SUIT'
              ? 'EVA Mode Active · Microgravity Float Engaged · Select Subsystems to Inspect'
              : 'Drag to Rotate 360° · Scroll to Zoom · Click Hazard Badges'}
          </div>

          {/* ── INTERACTIVE EVA SPACESUIT SUBSYSTEM HUD ── */}
          {modelType === 'SUIT' && (
            <div
              style={{
                position: 'absolute',
                bottom: 38,
                left: 12,
                maxWidth: 400,
                width: 'calc(100% - 24px)',
                background: 'rgba(6, 14, 24, 0.94)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                borderRadius: 10,
                padding: '8px 12px',
                zIndex: 22,
                boxShadow: '0 8px 32px rgba(0,0,0,0.85), 0 0 20px rgba(56, 189, 248, 0.25)',
              }}
            >
              {/* Subsystem Tabs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace', letterSpacing: '0.06em' }}>
                  EVA EMU SUBSYSTEMS:
                </span>
                {suitSubsystems.map(sub => {
                  const isSelected = selectedSuitSubsystem === sub.id;
                  return (
                    <button
                      key={sub.id}
                      onClick={() => focusSuitSubsystemRef.current && focusSuitSubsystemRef.current(sub.id)}
                      style={{
                        background: isSelected ? `${sub.color}26` : 'rgba(255, 255, 255, 0.05)',
                        border: isSelected ? `1px solid ${sub.color}` : '1px solid rgba(255, 255, 255, 0.1)',
                        color: isSelected ? sub.color : '#94a3b8',
                        borderRadius: 4,
                        padding: '3px 8px',
                        fontSize: 9,
                        fontWeight: isSelected ? 700 : 500,
                        fontFamily: 'monospace',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        boxShadow: isSelected ? `0 0 10px ${sub.color}40` : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: sub.color }} />
                      <span>{sub.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Selected Subsystem Detail Card */}
              {(() => {
                const activeSub = suitSubsystems.find(s => s.id === selectedSuitSubsystem) || suitSubsystems[1];
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', letterSpacing: '0.02em' }}>
                        {activeSub.name}
                      </span>
                      <span style={{
                        fontSize: 8.5,
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        color: activeSub.color,
                        background: `${activeSub.color}20`,
                        padding: '1px 6px',
                        borderRadius: 3,
                        border: `1px solid ${activeSub.color}40`,
                      }}>
                        {activeSub.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 9.5, color: '#94a3b8', lineHeight: 1.3 }}>
                      {activeSub.spec}
                    </div>
                    <div style={{
                      fontSize: 10,
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      color: activeSub.color,
                      marginTop: 2,
                      background: 'rgba(0,0,0,0.4)',
                      padding: '3px 6px',
                      borderRadius: 4,
                      borderLeft: `2px solid ${activeSub.color}`,
                    }}>
                      {activeSub.telemetry}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Floating Camera, Orbit & Laser Deck on 3D Viewport ── */}
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              right: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(6, 12, 22, 0.88)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 8,
              padding: '3px 6px',
              zIndex: 18,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
            }}
          >
            <button
              onClick={() => snapToAngle(0)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                borderRadius: 5,
                padding: '3px 7px',
                fontSize: 9.5,
                fontWeight: 600,
                fontFamily: 'monospace',
                cursor: 'pointer',
              }}
            >
              Front
            </button>
            <button
              onClick={() => snapToAngle(180)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                borderRadius: 5,
                padding: '3px 7px',
                fontSize: 9.5,
                fontWeight: 600,
                fontFamily: 'monospace',
                cursor: 'pointer',
              }}
            >
              Back
            </button>
            <button
              onClick={handleResetCamera}
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                color: '#38bdf8',
                borderRadius: 5,
                padding: '3px 7px',
                fontSize: 9.5,
                fontWeight: 700,
                fontFamily: 'monospace',
                cursor: 'pointer',
              }}
            >
              Reset
            </button>

            <span style={{ width: 1, height: 16, background: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

            {/* Orbit Toggle */}
            <button
              onClick={() => setAutoRotate(!autoRotate)}
              style={{
                background: autoRotate ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${autoRotate ? '#38bdf8' : 'rgba(255, 255, 255, 0.1)'}`,
                color: autoRotate ? '#38bdf8' : '#94a3b8',
                borderRadius: 5,
                padding: '3px 8px',
                fontSize: 9.5,
                fontWeight: 600,
                fontFamily: 'monospace',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {autoRotate ? <Pause size={10} /> : <Play size={10} />}
              <span>Orbit</span>
            </button>

            {/* Laser Scanner Mode */}
            <button
              onClick={() => {
                setLaserMode(prev => prev === 'OFF' ? 'SWEEP' : prev === 'SWEEP' ? 'LOCK_ORGAN' : 'OFF');
              }}
              style={{
                background: laserMode !== 'OFF' ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${laserMode !== 'OFF' ? '#38bdf8' : 'rgba(255, 255, 255, 0.1)'}`,
                color: laserMode !== 'OFF' ? '#38bdf8' : '#94a3b8',
                borderRadius: 5,
                padding: '3px 8px',
                fontSize: 9.5,
                fontWeight: 600,
                fontFamily: 'monospace',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.14s ease',
              }}
            >
              {laserMode === 'SWEEP' ? <Zap size={10} /> : laserMode === 'LOCK_ORGAN' ? <Crosshair size={10} /> : <Radio size={10} />}
              <span>{laserMode === 'SWEEP' ? 'Sweep' : laserMode === 'LOCK_ORGAN' ? 'Lock' : 'Beam'}</span>
            </button>
          </div>
        </div>

        {/* Right: Full Simultaneous Physiological Subsystems Panel (Shown in Split Mode) */}
        {viewMode === 'SPLIT' && (
          <div style={{
            borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(6, 10, 16, 0.72)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: '#1c2f42 #050a10',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Physiological Subsystems
                  </span>
                  <span style={{ fontSize: 8.5, color: '#64748b', fontFamily: 'monospace' }}>[4/4 LINKED]</span>
                </div>
                <span style={{
                  fontSize: 8.5,
                  fontFamily: 'monospace',
                  color: '#00e5a3',
                  fontWeight: 600,
                  background: 'rgba(0, 229, 163, 0.12)',
                  border: '1px solid rgba(0, 229, 163, 0.25)',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}>
                  ● LIVE 10 Hz
                </span>
              </div>

              {/* Subsystems Stack */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {hotspots.map(hs => {
                  const isSelected = selectedHotspot === hs.id;
                  const isCrit = hs.severity === 'CRITICAL';
                  const isWarn = hs.severity === 'WARNING';

                  const cardBorder = isSelected
                    ? '1px solid #38bdf8'
                    : isCrit
                      ? '1px solid rgba(239, 68, 68, 0.5)'
                      : isWarn
                        ? '1px solid rgba(245, 158, 11, 0.4)'
                        : '1px solid rgba(255, 255, 255, 0.08)';

                  const cardBg = isSelected
                    ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.14) 0%, rgba(8, 14, 22, 0.9) 100%)'
                    : isCrit
                      ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(15, 8, 8, 0.9) 100%)'
                      : isWarn
                        ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.10) 0%, rgba(15, 12, 6, 0.9) 100%)'
                        : 'rgba(9, 14, 22, 0.75)';

                  return (
                    <div
                      key={hs.id}
                      onClick={() => {
                        setSelectedHotspot(hs.id);
                        if (onSelectSubsystem) onSelectSubsystem(hs.id);
                      }}
                      style={{
                        background: cardBg,
                        border: cardBorder,
                        borderRadius: 10,
                        padding: '9px 12px',
                        cursor: 'pointer',
                        transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                        boxShadow: isSelected
                          ? '0 0 16px rgba(56, 189, 248, 0.2), inset 0 1px 0 rgba(255,255,255,0.08)'
                          : '0 2px 8px rgba(0,0,0,0.3)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: isCrit ? '#ef4444' : isWarn ? '#f59e0b' : '#38bdf8',
                            boxShadow: `0 0 6px ${isCrit ? '#ef4444' : isWarn ? '#f59e0b' : '#38bdf8'}`,
                            flexShrink: 0,
                          }} />
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#f8fafc', letterSpacing: '0.02em' }}>
                            {hs.id}
                          </span>
                          <span style={{ fontSize: 9, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            · {hs.organ}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <span style={{
                            fontSize: 8,
                            fontWeight: 700,
                            fontFamily: 'monospace',
                            padding: '2px 5px',
                            borderRadius: 3,
                            background: isCrit ? 'rgba(239, 68, 68, 0.18)' : isWarn ? 'rgba(245, 158, 11, 0.18)' : 'rgba(56, 189, 248, 0.12)',
                            color: isCrit ? '#f87171' : isWarn ? '#fbbf24' : '#38bdf8',
                            border: `1px solid ${isCrit ? 'rgba(239, 68, 68, 0.4)' : isWarn ? 'rgba(245, 158, 11, 0.35)' : 'rgba(56, 189, 248, 0.3)'}`,
                          }}>
                            {hs.severity}
                          </span>

                          <span style={{
                            fontSize: 8,
                            fontFamily: 'monospace',
                            padding: '2px 5px',
                            borderRadius: 3,
                            background: isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.05)',
                            color: isSelected ? '#030712' : '#94a3b8',
                            border: `1px solid ${isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.1)'}`,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 3,
                          }}>
                            {isSelected && <CheckCircle2 size={8} />}
                            <span>{isSelected ? 'ACTIVE' : hs.region.split(' ')[0]}</span>
                          </span>
                        </div>
                      </div>

                      {/* Metric Row */}
                      <div style={{
                        fontSize: 10.5,
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        color: isCrit ? '#fca5a5' : isWarn ? '#fde047' : '#e0f2fe',
                        marginBottom: 3,
                      }}>
                        {hs.metric}
                      </div>

                      {/* Clinical Detail */}
                      <div style={{ fontSize: 9, color: '#94a3b8', lineHeight: 1.35, marginBottom: 5 }}>
                        {hs.detail}
                      </div>

                      {/* Protocol Action Line */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'rgba(3, 7, 13, 0.75)',
                        borderRadius: 5,
                        padding: '4px 7px',
                        borderLeft: `2.5px solid ${isCrit ? '#ef4444' : isWarn ? '#f59e0b' : '#38bdf8'}`,
                      }}>
                        <span style={{ fontSize: 8.5, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '82%' }}>
                          <strong style={{ color: '#38bdf8' }}>RX:</strong> {hs.protocol}
                        </span>
                        <span style={{
                          fontSize: 8,
                          color: isSelected ? '#38bdf8' : '#64748b',
                          fontWeight: 700,
                          fontFamily: 'monospace',
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}>
                          {isSelected ? <CheckCircle2 size={8} /> : <Crosshair size={8} />}
                          <span>{isSelected ? 'ACTIVE' : 'TARGET'}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer Metadata */}
            <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 6, marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#64748b', fontFamily: 'monospace' }}>
              <span>STANDARD: NASA-STD-3001</span>
              <span>COHORT: OSDR INSPIRATION4</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
