/* ================================================================
   DiaCare — patient/record schema and mapping

   The single definition of what a patient and a health record look
   like in Firestore, and how the dashboard's display shape is derived
   from them.

   Field names deliberately match the Flutter app's Patient and
   HealthRecord classes (lib/models/), because the mobile app writes to
   these same two collections. Anywhere the two disagree, the app's
   spelling wins — a BHW's phone is the origin of most of this data,
   and renaming on the way in would mean translating on the way back
   out for every sync.

   The dashboard's older display fields (name, initials, glucose, bp,
   history, ...) are computed here rather than stored, so there is one
   copy of the truth and no chance of a stored summary drifting from
   the records it summarises.
   ================================================================ */

/* Official barangay list for Libon, Albay — all 40, matching the
   encoding form's list exactly. Reports and Risk Analysis iterate this
   rather than the barangays that happen to have patients, so a barangay
   with zero coverage shows as a gap instead of silently vanishing. */
export const BARANGAYS = [
  'Alongong', 'Apud', 'Bacolod', 'Bariw', 'Bonbon', 'Buga', 'Bulusan',
  'Burabod', 'Caguscos', 'East Carisac', 'West Carisac', 'Harigue',
  'Libtong', 'Linao', 'Mabayawas', 'Macabugos', 'Magallang', 'Malabiga',
  'Marayag', 'Matara', 'Molosbolos', 'Natasan', 'Niño Jesus', 'Nogpo',
  'Pantao', 'Rawis', 'Sagrada Familia', 'Salvacion', 'Sampongan',
  'San Agustin', 'San Antonio', 'San Isidro', 'San Jose', 'San Pascual',
  'San Ramon', 'San Vicente', 'Santa Cruz', 'Talin-talin', 'Tambo',
  'Villa Petrona',
];

/* ================================================================
   RISK

   One formula, used by the dashboard and mirrored by the app's
   RiskClassifier. Every page's Critical / At Risk / Normal bucketing
   agrees because they all call this rather than labelling risk
   themselves.
   ================================================================ */

/* A patient with no reading yet — approved but not yet visited, which
   is a real state — has nothing to score. That is "nothing abnormal
   observed", not zero risk of anything. */
export function calcScore(glucose, bpStr) {
  if (!bpStr || !glucose) return 0;
  const [sys, dia] = String(bpStr).split('/').map(Number);
  let score = 0;
  if (glucose >= 250 || glucose < 70) score += 60;
  else if (glucose >= 180) score += 35;
  if (sys >= 140 || dia >= 90) score += 40;
  else if (sys >= 120 || dia >= 80) score += 20;
  return score;
}

export function scoreToLevel(score) {
  if (score >= 60) return 'critical';
  if (score >= 30) return 'warning';
  return 'normal';
}

/* Display-only label. 'app' and 'manual' remain the stored values every
   filter compares against; this is purely how an origin reads. */
export function sourceToVisitLabel(source) {
  return source === 'app' ? 'Household Visit' : 'RHU Visit';
}

/* ================================================================
   FORMATTING
   ================================================================ */

/* Firestore hands back a Timestamp; a document written moments ago in
   this tab may still hold a Date, and a half-filled record may hold
   nothing at all. */
export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value) {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

export function formatTime(value) {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

export function ageFrom(birthDate) {
  const date = toDate(birthDate);
  if (!date) return null;
  const now = new Date();
  let years = now.getFullYear() - date.getFullYear();
  const monthDiff = now.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) years--;
  return years;
}

export function fullName(first, middle, last) {
  const initial = middle && middle.trim() ? ' ' + middle.trim()[0].toUpperCase() + '.' : '';
  return [first, initial, last].join(' ').replace(/\s+/g, ' ').trim();
}

export function initialsOf(first, last) {
  return ((first || '?')[0] + (last || '')[0] || '?').toUpperCase().slice(0, 2);
}

/* Avatar colour is derived from the id rather than stored or random, so
   the same patient is the same colour on every page and every reload. */
const AVATAR_COLORS = [
  '#178a53', '#2f8fb8', '#7c63d6', '#d9822b', '#d0362f',
  '#059669', '#0f766e', '#1e40af', '#92400e',
];

export function colorFor(id) {
  let hash = 0;
  for (let i = 0; i < String(id).length; i++) hash = (hash * 31 + String(id).charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/* ================================================================
   MAPPING

   recordToHistory turns a health_records document into the row shape
   the monitoring table and patient modal already render.
   ================================================================ */
export function recordToHistory(id, r) {
  const bp = (r.systolicBP && r.diastolicBP) ? r.systolicBP + '/' + r.diastolicBP : '';
  return {
    id,
    datetime: formatDateTime(r.visitDate || r.createdAt),
    visitDate: toDate(r.visitDate || r.createdAt),
    glucose: r.bloodGlucose ?? null,
    bp,
    status: scoreToLevel(calcScore(r.bloodGlucose, bp)),
    source: r.source === 'app' ? 'app' : 'manual',
    medicationName: r.medicationName || '',
    dosage: r.dosage || '',
    insulinUse: !!r.insulinUse,
    medicationAdherence: r.medAdherence || '',
    bmi: r.bmi ?? null,
    weight: r.weight ?? null,
    height: r.height ?? null,
    temp: r.temp ?? null,
    referral: r.referral || 'none',
    notes: r.observations || '',
    recordedBy: r.recordedBy || '',
  };
}

/* patientToView builds everything the pages read off a patient document
   plus that patient's records, newest first. */
export function patientToView(id, p, records) {
  const history = records
    .slice()
    .sort((a, b) => (b.visitDate?.getTime() || 0) - (a.visitDate?.getTime() || 0));
  const latest = history[0] || null;

  const bp = latest ? latest.bp : '';
  const glucose = latest ? latest.glucose : null;
  const score = calcScore(glucose, bp);

  return {
    id,
    /* Stored fields, names shared with the Flutter model */
    firstName: p.firstName || '',
    middleName: p.middleName || '',
    lastName: p.lastName || '',
    sex: p.sex || '',
    barangay: p.barangay || '',
    purok: p.purok || '',
    address: p.address || '',
    contactNumber: p.contactNumber || '',
    diabetesType: p.diabetesType || '',
    medications: p.medications || '',
    attendingPhysician: p.attendingPhysician || '',
    emergencyContactName: p.emergencyContact || '',
    emergencyContactNumber: p.emergencyContactNumber || '',
    assignedBhwId: p.assignedBhwId || '',
    /* The app writes Pending / Approved / Inactive; the dashboard has
       always said active. Normalised here so neither side has to know
       about the other's vocabulary. */
    status: String(p.status || 'approved').toLowerCase() === 'pending' ? 'pending'
      : String(p.status || '').toLowerCase() === 'inactive' ? 'inactive' : 'active',

    /* Derived for display */
    name: fullName(p.firstName, p.middleName, p.lastName),
    initials: initialsOf(p.firstName, p.lastName),
    color: colorFor(id),
    age: ageFrom(p.birthDate),
    dob: formatDate(p.birthDate),
    diagnosisDate: formatDate(p.diagnosisDate),
    birthDate: toDate(p.birthDate),

    /* Latest vitals — the monitoring table's columns */
    glucose,
    bp,
    weight: latest ? latest.weight : null,
    temp: latest ? latest.temp : null,
    bmi: latest ? latest.bmi : null,
    source: latest ? latest.source : 'manual',
    time: latest ? formatTime(latest.visitDate) : '',
    referral: latest ? latest.referral : 'none',
    lastVisit: latest ? latest.visitDate : null,

    riskScore: score,
    risk: scoreToLevel(score),

    flagged: !!p.flagged,
    flagReason: p.flagReason || undefined,
    flagNotes: p.flagNotes || undefined,
    missedToday: !!p.missedToday,

    visitCount: history.length,
    history,
  };
}
