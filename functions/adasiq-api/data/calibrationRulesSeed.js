/**
 * Universal ADAS Calibration Rules Seed Data
 * Source: ADAS IQ trigger logic, OEM position statements, industry standards
 * make/model/year_start/year_end left blank = applies to ALL makes/models/years
 */

export const UNIVERSAL_RULES = [

  // ─── WINDSHIELD / GLASS ───────────────────────────────────────────────────

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'WINDSHIELD',
    trigger_keywords: 'windshield,windscreen,front glass,w/s replace,w/s r&r,w/s r&i',
    required_equipment: 'Forward Camera,Front Camera,Lane Departure,LDW,LKA,Lane Keep,Pre-Collision,PCS,AEB,Forward Collision,TSR,Traffic Sign,AHB,Auto High Beam',
    calibration_name: 'Forward Camera / ADAS Camera',
    cal_type: 'Static',
    justification_template: 'Forward camera calibration required per {make} OEM position statement and industry standard procedures following windshield replacement. Any windshield replacement or R&R disturbs the forward-facing camera mounting angle and field of view. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '10',
    notes: 'Applies whenever windshield is replaced or R&R\'d on any vehicle with a windshield-mounted camera system',
  },

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'WINDSHIELD',
    trigger_keywords: 'windshield,windscreen,front glass,w/s replace,w/s r&r,w/s r&i',
    required_equipment: 'Lane Departure Warning,Lane Departure Alert,LDW,LDA,Lane Keep Assist,LKA,Lane Tracing',
    calibration_name: 'Lane Departure Warning / Lane Keep Assist',
    cal_type: 'Static',
    justification_template: 'Lane Departure Warning and Lane Keep Assist camera calibration required per {make} OEM position statement following windshield replacement. The windshield-mounted camera requires recalibration to accurately detect lane markings. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '10',
    notes: 'LDW/LKA are typically part of the same forward camera — may be combined with Forward Camera rule',
  },

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'WINDSHIELD',
    trigger_keywords: 'windshield,windscreen,front glass,w/s replace,w/s r&r,w/s r&i',
    required_equipment: 'EyeSight,Subaru EyeSight,Stereo Camera',
    calibration_name: 'EyeSight Stereo Camera',
    cal_type: 'Static',
    justification_template: 'Subaru EyeSight stereo camera calibration required per Subaru OEM position statement following windshield replacement. EyeSight uses two windshield-mounted stereo cameras that are extremely sensitive to alignment changes — replacement always requires dealer-level calibration. Failure to calibrate presents a safety liability and does not meet Subaru OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '10',
    notes: 'Subaru EyeSight is especially sensitive — always requires calibration after windshield work',
  },

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'WINDSHIELD',
    trigger_keywords: 'windshield,windscreen,front glass,w/s replace,w/s r&r,w/s r&i',
    required_equipment: 'Traffic Sign Recognition,TSR',
    calibration_name: 'Traffic Sign Recognition Camera',
    cal_type: 'Static',
    justification_template: 'Traffic Sign Recognition camera calibration required per {make} OEM position statement following windshield replacement. The TSR camera is mounted to the windshield and must be recalibrated after any glass replacement. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '9',
    notes: 'Often part of the same forward camera module',
  },

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'WINDSHIELD',
    trigger_keywords: 'windshield,windscreen,front glass,w/s replace,w/s r&r,w/s r&i',
    required_equipment: 'Automatic High Beam,AHB,Auto High Beam,Adaptive High Beam',
    calibration_name: 'Automatic High Beam Control',
    cal_type: 'Static',
    justification_template: 'Automatic High Beam control camera calibration required per {make} OEM position statement following windshield replacement. The AHB camera is typically integrated into the forward camera module and must be recalibrated after glass replacement. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '9',
    notes: 'Often integrated with forward camera module',
  },

  // ─── FRONT BUMPER / GRILLE / FASCIA ──────────────────────────────────────

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'FRONT_BUMPER',
    trigger_keywords: 'front bumper,front fascia,front cover,bumper cover,impact bar,front grille,upper grille,grille emblem,grille assy,front lower,front spoiler',
    required_equipment: 'Adaptive Cruise,Intelligent Cruise,Radar Cruise,ACC,Pre-Collision,Forward Collision,AEB,Front Radar,Millimeter Wave Radar',
    calibration_name: 'Pre-Collision System / Front Radar',
    cal_type: 'Static',
    justification_template: 'Front radar calibration required per {make} OEM position statement following front bumper/grille replacement. The front radar sensor sits behind the grille or bumper emblem and requires recalibration any time the surrounding structure is disturbed. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '10',
    notes: 'Front radar is often hidden behind grille, upper grille, or front emblem on most makes',
  },

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'FRONT_BUMPER',
    trigger_keywords: 'front radar,radar sensor,millimeter wave,front sensor,adas sensor replace',
    required_equipment: 'Adaptive Cruise,Intelligent Cruise,Radar Cruise,ACC,Pre-Collision,Forward Collision,AEB,Front Radar',
    calibration_name: 'Pre-Collision System / Front Radar',
    cal_type: 'Static',
    justification_template: 'Front radar calibration required per {make} OEM position statement following radar sensor replacement. Direct replacement of the radar sensor always requires recalibration to restore proper targeting and range. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '10',
    notes: 'Direct radar sensor R&I or replacement always requires calibration',
  },

  // ─── FRONT SUSPENSION / STEERING / ALIGNMENT ─────────────────────────────

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'FRONT_SUSPENSION',
    trigger_keywords: 'knuckle,control arm,strut,strut assembly,wheel bearing,tie rod,subframe,crossmember,front suspension,alignment,front alignment,four wheel alignment,wheel alignment sublet',
    required_equipment: '',
    calibration_name: 'Steering Angle Sensor',
    cal_type: 'Static',
    justification_template: 'Steering Angle Sensor (SAS) calibration required per {make} OEM position statement following front suspension repair and wheel alignment. Any change to front-end geometry — including alignment — requires the SAS to be recalibrated to the new steering center. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '10',
    notes: 'SAS calibration required after any front suspension work or alignment — applies to all vehicles',
  },

  // ─── HEADLIGHTS ───────────────────────────────────────────────────────────

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'HEADLIGHTS',
    trigger_keywords: 'headlamp,headlight,head lamp,head light,headlamp assembly,headlight assembly',
    required_equipment: '',
    calibration_name: 'Headlamp Aim',
    cal_type: 'Static',
    justification_template: 'Headlamp aim required per {make} OEM position statement following headlamp assembly replacement. Replaced headlamp assemblies must be aimed to ensure proper illumination and to avoid blinding oncoming traffic. Failure to aim presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '9',
    notes: 'Often already included as a CCC line item — do not duplicate if already present in estimate',
  },

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'HEADLIGHTS',
    trigger_keywords: 'headlamp,headlight,head lamp,head light',
    required_equipment: 'Adaptive Headlight,ADB,Active High Beam,Matrix LED,Adaptive Driving Beam',
    calibration_name: 'Adaptive Driving Beam / Adaptive Headlight',
    cal_type: 'Static',
    justification_template: 'Adaptive headlight/driving beam calibration required per {make} OEM position statement following headlamp replacement. Adaptive headlight systems use cameras and actuators that require recalibration after assembly replacement. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '9',
    notes: 'Only applies if vehicle is equipped with ADB or adaptive headlight system',
  },

  // ─── REAR BUMPER / FASCIA ─────────────────────────────────────────────────

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'REAR_BUMPER',
    trigger_keywords: 'rear bumper,rear fascia,rear cover,rear impact bar,rear reinforcement',
    required_equipment: 'Blind Spot,BSM,Rear Cross Traffic,RCTA,Rear Radar,Rear Sensor',
    calibration_name: 'Rear Radar / Blind Spot Monitor',
    cal_type: 'Static',
    justification_template: 'Rear radar calibration required per {make} OEM position statement following rear bumper replacement. Rear radar sensors for Blind Spot Monitoring and Rear Cross Traffic Alert are mounted in or behind the rear bumper and must be recalibrated when the surrounding structure is disturbed. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '9',
    notes: 'Only applies if vehicle is equipped with BSM or RCTA. R&I alone may not require calibration.',
  },

  // ─── QUARTER PANELS / REAR CORNERS ───────────────────────────────────────

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'QUARTER_PANEL',
    trigger_keywords: 'left quarter,lh quarter,left rear quarter,quarter panel left,quarter replace left',
    required_equipment: 'Blind Spot,BSM,Blind Spot Monitor,Blind Spot Detection',
    calibration_name: 'Blind Spot Monitor — Left Radar',
    cal_type: 'Static',
    justification_template: 'Left Blind Spot Monitor radar calibration required per {make} OEM position statement following left quarter panel replacement. The left BSM radar sensor is mounted in the left rear quarter panel area and requires recalibration when the surrounding structure is replaced or significantly repaired. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '9',
    notes: 'BSM radar is typically mounted in the rear quarter panel or rear bumper area',
  },

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'QUARTER_PANEL',
    trigger_keywords: 'right quarter,rh quarter,right rear quarter,quarter panel right,quarter replace right',
    required_equipment: 'Blind Spot,BSM,Blind Spot Monitor,Blind Spot Detection',
    calibration_name: 'Blind Spot Monitor — Right Radar',
    cal_type: 'Static',
    justification_template: 'Right Blind Spot Monitor radar calibration required per {make} OEM position statement following right quarter panel replacement. The right BSM radar sensor is mounted in the right rear quarter panel area and requires recalibration when the surrounding structure is replaced or significantly repaired. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '9',
    notes: 'BSM radar is typically mounted in the rear quarter panel or rear bumper area',
  },

  // ─── DOOR MIRRORS ─────────────────────────────────────────────────────────

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'MIRROR',
    trigger_keywords: 'left mirror,lh mirror,driver mirror,driver side mirror,left door mirror',
    required_equipment: 'Blind Spot,BSM,Blind Spot Monitor,Blind Spot Detection',
    calibration_name: 'Blind Spot Monitor — Left Mirror Sensor',
    cal_type: 'Static',
    justification_template: 'Left Blind Spot Monitor sensor calibration required per {make} OEM position statement following left mirror replacement. On this vehicle, the BSM radar sensor is integrated into the mirror housing and must be recalibrated after replacement. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '8',
    notes: 'Applies to makes that mount BSM radar in the mirror housing (many makes/models do this)',
  },

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'MIRROR',
    trigger_keywords: 'right mirror,rh mirror,passenger mirror,passenger side mirror,right door mirror',
    required_equipment: 'Blind Spot,BSM,Blind Spot Monitor,Blind Spot Detection',
    calibration_name: 'Blind Spot Monitor — Right Mirror Sensor',
    cal_type: 'Static',
    justification_template: 'Right Blind Spot Monitor sensor calibration required per {make} OEM position statement following right mirror replacement. On this vehicle, the BSM radar sensor is integrated into the mirror housing and must be recalibrated after replacement. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '8',
    notes: 'Applies to makes that mount BSM radar in the mirror housing',
  },

  // ─── REAR CAMERA ─────────────────────────────────────────────────────────

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'REAR_CAMERA',
    trigger_keywords: 'liftgate,trunk lid,decklid,rear door,tailgate replace,backup camera,rear camera,reverse camera',
    required_equipment: 'Backup Camera,Rear Camera,Reverse Camera,Surround View,360 Camera',
    calibration_name: 'Backup / Rear Camera',
    cal_type: 'Static',
    justification_template: 'Backup camera calibration required per {make} OEM position statement following liftgate or camera-mounted component replacement. When the camera mounting position is disturbed, the display image and parking guidelines must be recalibrated. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '8',
    notes: 'R&I of rear bumper alone typically does not require calibration unless camera is visibly disturbed',
  },

  // ─── PARKING SENSORS ─────────────────────────────────────────────────────

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'PARKING_SENSORS',
    trigger_keywords: 'front bumper replace,rear bumper replace,parking sensor,park sensor,ultrasonic sensor',
    required_equipment: 'Parking Sensors,Park Assist,Parking Assist,Ultrasonic Sensors',
    calibration_name: 'Parking Sensor Calibration',
    cal_type: 'Static',
    justification_template: 'Parking sensor calibration required per {make} OEM position statement following bumper replacement. Ultrasonic parking sensors embedded in the bumper must be recalibrated after the bumper is replaced to ensure accurate proximity detection. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '7',
    notes: 'Applies when parking sensors are embedded in replaced bumper covers',
  },

  // ─── SURROUND VIEW / 360 CAMERA ──────────────────────────────────────────

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'SURROUND_VIEW',
    trigger_keywords: 'front bumper,rear bumper,left mirror,right mirror,liftgate,side camera',
    required_equipment: 'Surround View,360 Camera,Bird Eye,Panoramic Camera,Multi-View Camera',
    calibration_name: 'Surround View / 360 Camera',
    cal_type: 'Static',
    justification_template: 'Surround View camera calibration required per {make} OEM position statement following repair to camera-mounted components. Surround view systems use multiple cameras (front, rear, mirrors) that must all be calibrated together for the composite image to be accurate. Failure to calibrate presents a safety liability and does not meet {make} OEM repair standards.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '8',
    notes: 'Requires special calibration mat and may require all four camera positions to be reset',
  },

  // ─── BATTERY DISCONNECT ───────────────────────────────────────────────────

  {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'BATTERY',
    trigger_keywords: 'battery disconnect,battery r&i,battery replace',
    required_equipment: 'Steering Angle Sensor,SAS,Pre-Collision,Power Steering,EPS',
    calibration_name: 'SAS / ADAS Relearn After Battery Disconnect',
    cal_type: 'Static',
    justification_template: 'Steering Angle Sensor relearn required per {make} OEM position statement following battery disconnect. Some vehicles require SAS and other ADAS system relearns after battery power is interrupted. Failure to perform relearn may cause warning lights and degraded safety system performance.',
    source: 'UNIVERSAL',
    enabled: 'true',
    rule_priority: '6',
    notes: 'Make/model specific — some vehicles require this, others do not. Flag for technician review.',
  },

]
