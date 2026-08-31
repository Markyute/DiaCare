'use strict';
/* ================================================================
   DiaCare — Shared Patient Roster
   There's no backend yet, so this is the stand-in for what would
   normally be a database query: a single client-side source of
   truth for every patient-related stat shown across the app
   (Dashboard, Patient Monitoring, Reports, High-Risk Alerts, Risk
   Analysis, and the Login screen's headline tiles via shared/stats.js).

   Previously each of those pages declared its own independent mock
   patient array with a different size and membership, so "Total
   Patients" (and "Critical"/"At Risk" counts) disagreed from page
   to page. Now every page reads window.DiaCarePatients.PATIENTS (or
   the derived helpers below) so the same person is counted the same
   way everywhere. In production this file is replaced by an API call.
   ================================================================ */
(function () {
  /* Official barangay list for Libon, Albay — all 40, matching the
     encoding form's list exactly. Previously this was a 15-item subset
     (only barangays that happened to have mock patients), which meant
     Reports/Risk Analysis could never show a barangay with zero patients
     — quietly hiding coverage gaps instead of surfacing them, which is
     the opposite of what a BHN cross-barangay view is supposed to do. */
  const BARANGAYS = [
    'Alongong', 'Apud', 'Bacolod', 'Bariw', 'Bonbon', 'Buga', 'Bulusan',
    'Burabod', 'Caguscos', 'East Carisac', 'West Carisac', 'Harigue',
    'Libtong', 'Linao', 'Mabayawas', 'Macabugos', 'Magallang', 'Malabiga',
    'Marayag', 'Matara', 'Molosbolos', 'Natasan', 'Niño Jesus', 'Nogpo',
    'Pantao', 'Rawis', 'Sagrada Familia', 'Salvacion', 'Sampongan',
    'San Agustin', 'San Antonio', 'San Isidro', 'San Jose', 'San Pascual',
    'San Ramon', 'San Vicente', 'Santa Cruz', 'Talin-talin', 'Tambo',
    'Villa Petrona',
  ];

  /* Risk score 0-100 from the two vitals that matter for diabetes
     follow-up (glucose weighted 60%, blood pressure 40%). Having one
     formula means every page's Critical/At Risk/Normal bucketing
     agrees instead of each page hand-labeling risk independently. */
  function calcScore(glucose, bpStr) {
    // A patient who hasn't had a first reading yet (e.g. still pending
    // BHN approval, per the app's own workflow) has no glucose/BP to
    // score — treat that as "nothing abnormal yet" rather than crashing.
    if (!bpStr || !glucose) return 0;
    const [sys, dia] = bpStr.split('/').map(Number);
    let score = 0;
    if (glucose >= 250 || glucose < 70) score += 60;
    else if (glucose >= 180) score += 35;
    if (sys >= 140 || dia >= 90) score += 40;
    else if (sys >= 120 || dia >= 80) score += 20;
    return score;
  }
  function scoreToLevel(score) {
    if (score >= 60) return 'critical';
    if (score >= 30) return 'warning';
    return 'normal';
  }

  /* Display-only label for a health record's source — 'app'/'manual'
     stay the underlying values every filter/comparison across the site
     already checks against, this is purely how a record's origin reads
     to the nurse (BHW household visit vs. an RHU-side visit). */
  function sourceToVisitLabel(source) {
    return source === 'app' ? 'Household Visit' : 'RHU Visit';
  }

  /* history entries are newest-first (index 0 = most recent), same
     convention Patient Monitoring's detail modal already used.
     Every entry defaults to status: 'active' below (see PATIENTS/
     PENDING_PATIENTS split) — only the two BHW-submitted patients at
     the end are marked 'pending'. */
  const RAW_PATIENTS = [
    {
      id: 'P-0001', name: 'Maria Santos', initials: 'MS', color: '#178a53',
      firstName: 'Maria', middleName: '', lastName: 'Santos',
      age: 45, sex: 'Female', barangay: 'San Jose',
      dob: 'Mar 22, 1981', address: '45 Rizal St.', purok: 'Purok 2',
      contactNumber: '0917 111 2222', diabetesType: 'Type 2',
      diagnosisDate: 'Feb 14, 2020', medications: 'Metformin 500mg',
      attendingPhysician: 'Dr. Fernandez',
      emergencyContactName: 'Jose Santos', emergencyContactNumber: '0917 111 3333',
      glucose: 118, bp: '120/80', weight: 58, temp: 36.5, bmi: 24.1,
      source: 'app', time: '8:14 AM', flagged: false, missedToday: false,
      referral: 'none', visitCount: 14,
      history: [
        { datetime: 'Aug 8, 2026 8:14 AM', glucose: 118, bp: '120/80', status: 'normal', source: 'app',
          medicationName: 'Metformin', dosage: '500mg, twice daily', insulinUse: false,
          medicationAdherence: 'taken', bmi: 24.1, notes: 'Patient reports feeling well, no complaints.',
          recordedBy: 'BHW Pedro Bautista' },
        { datetime: 'Aug 5, 2026 9:00 AM', glucose: 132, bp: '122/82', status: 'normal', source: 'app' },
        { datetime: 'Aug 1, 2026 8:45 AM', glucose: 145, bp: '125/84', status: 'warning', source: 'manual' },
      ],
    },
    {
      id: 'P-0002', name: 'Roberto Garcia', initials: 'RG', color: '#d0362f',
      firstName: 'Roberto', middleName: '', lastName: 'Garcia',
      age: 67, sex: 'Male', barangay: 'San Jose',
      dob: 'Jul 5, 1959', address: '8 Bonifacio St.', purok: 'Purok 1',
      contactNumber: '0918 222 3333', diabetesType: 'Type 2',
      diagnosisDate: 'Jun 3, 2015', medications: 'Insulin Glargine 10 units',
      attendingPhysician: 'Dr. Fernandez',
      emergencyContactName: 'Corazon Garcia', emergencyContactNumber: '0918 222 4444',
      glucose: 312, bp: '145/95', weight: 74, temp: 37.1, bmi: 28.5,
      source: 'app', time: '8:32 AM', flagged: false, missedToday: false,
      referral: 'hospital', visitCount: 12,
      history: [
        { datetime: 'Aug 8, 2026 8:32 AM', glucose: 312, bp: '145/95', status: 'critical', source: 'app',
          medicationName: 'Insulin Glargine', dosage: '10 units, once daily (evening)', insulinUse: true,
          medicationAdherence: 'missed', bmi: 28.5, notes: 'Patient appears fatigued. Missed medication for 3 days.',
          recordedBy: 'BHW Pedro Bautista' },
        { datetime: 'Aug 5, 2026 9:15 AM', glucose: 280, bp: '140/92', status: 'critical', source: 'app' },
        { datetime: 'Aug 1, 2026 9:00 AM', glucose: 265, bp: '138/90', status: 'critical', source: 'manual' },
      ],
    },
    {
      id: 'P-0003', name: 'Ana Reyes', initials: 'AR', color: '#c2760a',
      firstName: 'Ana', middleName: '', lastName: 'Reyes',
      age: 52, sex: 'Female', barangay: 'San Jose',
      dob: 'Nov 30, 1973', address: '22 Del Pilar St.', purok: 'Purok 3',
      contactNumber: '0919 333 4444', diabetesType: 'Type 2',
      diagnosisDate: 'Not specified', medications: 'Glipizide 5mg',
      attendingPhysician: 'Not specified',
      emergencyContactName: 'Mark Reyes', emergencyContactNumber: '0919 333 5555',
      glucose: 204, bp: '130/85', weight: 62, temp: 36.8, bmi: 25.8,
      source: 'manual', time: '8:51 AM', flagged: false, missedToday: false,
      referral: 'rhu', visitCount: 8,
      history: [
        { datetime: 'Aug 8, 2026 8:51 AM', glucose: 204, bp: '130/85', status: 'warning', source: 'manual',
          medicationName: 'Glipizide', dosage: '5mg, once daily (morning)', insulinUse: false,
          medicationAdherence: 'partial', bmi: 26.1, notes: 'Encoded at RHU — patient walk-in, no app used.',
          recordedBy: 'RHU Nurse Ana Cruz' },
        { datetime: 'Aug 3, 2026 8:30 AM', glucose: 188, bp: '128/82', status: 'warning', source: 'manual' },
      ],
    },
    {
      id: 'P-0004', name: 'Juan Cruz', initials: 'JC', color: '#3b82f6',
      firstName: 'Juan', middleName: '', lastName: 'Cruz',
      age: 38, sex: 'Male', barangay: 'Burabod',
      dob: 'Apr 18, 1988', address: '5 Luna St.', purok: 'Purok 1',
      contactNumber: '0920 444 5555', diabetesType: 'Type 2',
      diagnosisDate: 'Sep 10, 2023', medications: 'Metformin 500mg',
      attendingPhysician: 'Dr. Ramos',
      emergencyContactName: 'Liza Cruz', emergencyContactNumber: '0920 444 6666',
      glucose: 95, bp: '118/76', weight: 68, temp: 36.6, bmi: 24.1,
      source: 'app', time: '9:10 AM', flagged: false, missedToday: false,
      referral: 'none', visitCount: 11,
      history: [
        { datetime: 'Aug 8, 2026 9:10 AM', glucose: 95, bp: '118/76', status: 'normal', source: 'app' },
        { datetime: 'Aug 1, 2026 9:30 AM', glucose: 102, bp: '120/78', status: 'normal', source: 'app' },
      ],
    },
    {
      id: 'P-0005', name: 'Lorna Dela Rosa', initials: 'LD', color: '#d0362f',
      firstName: 'Lorna', middleName: '', lastName: 'Dela Rosa',
      age: 71, sex: 'Female', barangay: 'San Jose',
      dob: 'Jan 9, 1955', address: '30 Aguinaldo St.', purok: 'Purok 4',
      contactNumber: '0917 555 6666', diabetesType: 'Type 2',
      diagnosisDate: 'Mar 1, 2010', medications: 'Metformin 500mg',
      attendingPhysician: 'Dr. Fernandez',
      emergencyContactName: 'Rico Dela Rosa', emergencyContactNumber: '0917 555 7777',
      glucose: 58, bp: '100/65', weight: 52, temp: 36.4, bmi: 23.1,
      source: 'app', time: '9:28 AM', flagged: false, missedToday: false,
      referral: 'none', visitCount: 9,
      history: [
        { datetime: 'Aug 8, 2026 9:28 AM', glucose: 58, bp: '100/65', status: 'critical', source: 'app' },
        { datetime: 'Aug 5, 2026 10:00 AM', glucose: 72, bp: '108/70', status: 'normal', source: 'app' },
      ],
    },
    {
      id: 'P-0006', name: 'Pedro Bautista', initials: 'PB', color: '#c2760a',
      firstName: 'Pedro', middleName: '', lastName: 'Bautista',
      age: 55, sex: 'Male', barangay: 'Villa Petrona',
      dob: 'Aug 2, 1971', address: '14 Villa Petrona Rd.', purok: 'Purok 2',
      contactNumber: '0918 666 7777', diabetesType: 'Type 2',
      diagnosisDate: 'Not specified', medications: 'Metformin 500mg',
      attendingPhysician: 'Not specified',
      emergencyContactName: 'Norma Bautista', emergencyContactNumber: '0918 666 8888',
      glucose: 186, bp: '135/88', weight: 80, temp: 36.9, bmi: 27.7,
      source: 'manual', time: '9:45 AM', flagged: false, missedToday: false,
      referral: 'none', visitCount: 7,
      history: [
        { datetime: 'Aug 8, 2026 9:45 AM', glucose: 186, bp: '135/88', status: 'warning', source: 'manual' },
        { datetime: 'Aug 4, 2026 9:20 AM', glucose: 180, bp: '132/86', status: 'warning', source: 'manual' },
        { datetime: 'Jul 30, 2026 9:00 AM', glucose: 172, bp: '128/84', status: 'normal', source: 'manual' },
      ],
    },
    {
      id: 'P-0007', name: 'Elena Ramos', initials: 'ER', color: '#178a53',
      firstName: 'Elena', middleName: '', lastName: 'Ramos',
      age: 42, sex: 'Female', barangay: 'San Jose',
      dob: 'May 27, 1984', address: '9 Quezon St.', purok: 'Purok 5',
      contactNumber: '0919 777 8888', diabetesType: 'Type 2',
      diagnosisDate: 'Jul 20, 2021', medications: 'Metformin 500mg',
      attendingPhysician: 'Dr. Fernandez',
      emergencyContactName: 'Noel Ramos', emergencyContactNumber: '0919 777 9999',
      glucose: 132, bp: '122/78', weight: 55, temp: 36.7, bmi: 22.6,
      source: 'app', time: '10:02 AM', flagged: false, missedToday: false,
      referral: 'none', visitCount: 9,
      history: [
        { datetime: 'Aug 8, 2026 10:02 AM', glucose: 132, bp: '122/78', status: 'normal', source: 'app' },
        { datetime: 'Aug 3, 2026 9:00 AM', glucose: 128, bp: '120/76', status: 'normal', source: 'app' },
      ],
    },
    {
      id: 'P-0008', name: 'Carlos Tan', initials: 'CT', color: '#7c5ce0',
      firstName: 'Carlos', middleName: '', lastName: 'Tan',
      age: 60, sex: 'Male', barangay: 'Burabod',
      dob: 'Dec 12, 1966', address: '17 Burabod Ave.', purok: 'Purok 3',
      contactNumber: '0920 888 9999', diabetesType: 'Type 2',
      diagnosisDate: 'Apr 5, 2018', medications: 'Metformin 850mg',
      attendingPhysician: 'Dr. Ramos',
      emergencyContactName: 'Grace Tan', emergencyContactNumber: '0920 888 0000',
      glucose: 261, bp: '150/98', weight: 85, temp: 37.2, bmi: 28.7,
      source: 'manual', time: '10:19 AM', flagged: false, missedToday: false,
      referral: 'hospital', visitCount: 9,
      history: [
        { datetime: 'Aug 8, 2026 10:19 AM', glucose: 261, bp: '150/98', status: 'critical', source: 'manual' },
        { datetime: 'Aug 1, 2026 8:00 AM', glucose: 240, bp: '148/95', status: 'critical', source: 'manual' },
      ],
    },
    {
      id: 'P-0009', name: 'Rosa Villanueva', initials: 'RV', color: '#106d42',
      firstName: 'Rosa', middleName: '', lastName: 'Villanueva',
      age: 33, sex: 'Female', barangay: 'Harigue',
      dob: 'Feb 14, 1993', address: '3 Harigue Rd.', purok: 'Purok 1',
      contactNumber: '0917 999 0000', diabetesType: 'Type 2',
      diagnosisDate: 'Oct 8, 2024', medications: 'Metformin 500mg',
      attendingPhysician: 'Dr. Santos',
      emergencyContactName: 'Miguel Villanueva', emergencyContactNumber: '0917 999 1111',
      glucose: 108, bp: '116/74', weight: 50, temp: 36.5, bmi: 20.0,
      source: 'app', time: '10:35 AM', flagged: false, missedToday: false,
      referral: 'none', visitCount: 8,
      history: [
        { datetime: 'Aug 8, 2026 10:35 AM', glucose: 108, bp: '116/74', status: 'normal', source: 'app' },
        { datetime: 'Aug 4, 2026 10:10 AM', glucose: 114, bp: '118/76', status: 'normal', source: 'app' },
        { datetime: 'Jul 30, 2026 9:50 AM', glucose: 120, bp: '120/78', status: 'normal', source: 'app' },
      ],
    },
    {
      id: 'P-0010', name: 'Dante Pascual', initials: 'DP', color: '#f97316',
      firstName: 'Dante', middleName: '', lastName: 'Pascual',
      age: 48, sex: 'Male', barangay: 'Villa Petrona',
      dob: 'Sep 3, 1978', address: '21 Villa Petrona Rd.', purok: 'Purok 3',
      contactNumber: '0918 000 1111', diabetesType: 'Type 2',
      diagnosisDate: 'Not specified', medications: 'Metformin 500mg',
      attendingPhysician: 'Not specified',
      emergencyContactName: 'Julia Pascual', emergencyContactNumber: '0918 000 2222',
      glucose: 195, bp: '132/86', weight: 72, temp: 36.8, bmi: 25.2,
      source: 'app', time: '10:50 AM', flagged: false, missedToday: false,
      referral: 'none', visitCount: 10,
      history: [
        { datetime: 'Aug 8, 2026 10:50 AM', glucose: 195, bp: '132/86', status: 'warning', source: 'app' },
        { datetime: 'Aug 5, 2026 9:30 AM', glucose: 178, bp: '128/84', status: 'warning', source: 'app' },
      ],
    },
    {
      id: 'P-0011', name: 'Teresita Molina', initials: 'TM', color: '#d9822b',
      firstName: 'Teresita', middleName: '', lastName: 'Molina',
      age: 68, sex: 'Female', barangay: 'Malabiga',
      dob: 'Jun 19, 1958', address: '11 Malabiga St.', purok: 'Purok 2',
      contactNumber: '0919 111 2222', diabetesType: 'Type 2',
      diagnosisDate: 'Jan 15, 2012', medications: 'Glipizide 5mg',
      attendingPhysician: 'Dr. Fernandez',
      emergencyContactName: 'Ramon Molina', emergencyContactNumber: '0919 111 3333',
      glucose: 226, bp: '138/88', weight: 60, temp: 36.9, bmi: 26.1,
      source: 'app', time: '11:05 AM', flagged: false, missedToday: false,
      referral: 'rhu', visitCount: 11,
      history: [
        { datetime: 'Aug 8, 2026 11:05 AM', glucose: 226, bp: '138/88', status: 'warning', source: 'app' },
        { datetime: 'Aug 4, 2026 10:00 AM', glucose: 229, bp: '137/87', status: 'warning', source: 'app' },
        { datetime: 'Jul 30, 2026 9:30 AM', glucose: 235, bp: '140/89', status: 'critical', source: 'app' },
      ],
    },
    {
      id: 'P-0012', name: 'Erlinda Tan', initials: 'ET', color: '#64748b',
      firstName: 'Erlinda', middleName: '', lastName: 'Tan',
      age: 62, sex: 'Female', barangay: 'Harigue',
      dob: 'Oct 8, 1964', address: '6 Harigue Rd.', purok: 'Purok 4',
      contactNumber: '0920 222 3333', diabetesType: 'Type 2',
      diagnosisDate: 'Feb 28, 2016', medications: 'Metformin 500mg',
      attendingPhysician: 'Dr. Santos',
      emergencyContactName: 'Bobby Tan', emergencyContactNumber: '0920 222 4444',
      glucose: 162, bp: '124/80', weight: 57, temp: 36.6, bmi: 24.0,
      source: 'app', time: '—', flagged: false, missedToday: true,
      referral: 'none', visitCount: 4,
      history: [
        { datetime: 'Aug 4, 2026 9:20 AM', glucose: 162, bp: '124/80', status: 'normal', source: 'app' },
        { datetime: 'Jul 31, 2026 9:00 AM', glucose: 165, bp: '125/81', status: 'normal', source: 'app' },
        { datetime: 'Jul 27, 2026 8:50 AM', glucose: 168, bp: '126/82', status: 'normal', source: 'app' },
      ],
    },
    {
      id: 'P-0013', name: 'Danilo Cruz', initials: 'DC', color: '#1e40af',
      firstName: 'Danilo', middleName: '', lastName: 'Cruz',
      age: 50, sex: 'Male', barangay: 'Burabod',
      dob: 'Mar 3, 1976', address: '19 Burabod Ave.', purok: 'Purok 1',
      contactNumber: '0917 333 4444', diabetesType: 'Type 2',
      diagnosisDate: 'Nov 11, 2019', medications: 'Metformin 500mg',
      attendingPhysician: 'Dr. Ramos',
      emergencyContactName: 'Fe Cruz', emergencyContactNumber: '0917 333 5555',
      glucose: 218, bp: '136/87', weight: 78, temp: 37.0, bmi: 26.7,
      source: 'app', time: '—', flagged: false, missedToday: true,
      referral: 'none', visitCount: 5,
      history: [
        { datetime: 'Aug 6, 2026 9:15 AM', glucose: 218, bp: '136/87', status: 'warning', source: 'app' },
        { datetime: 'Aug 2, 2026 9:00 AM', glucose: 210, bp: '133/85', status: 'warning', source: 'app' },
        { datetime: 'Jul 28, 2026 8:45 AM', glucose: 200, bp: '130/84', status: 'warning', source: 'app' },
      ],
    },
    {
      id: 'P-0014', name: 'Andres Navarro', initials: 'AN', color: '#6b7280',
      firstName: 'Andres', middleName: '', lastName: 'Navarro',
      age: 37, sex: 'Male', barangay: 'Pantao',
      dob: 'Aug 25, 1989', address: '2 Pantao Rd.', purok: 'Purok 2',
      contactNumber: '0918 444 5555', diabetesType: 'Type 2',
      diagnosisDate: 'May 30, 2022', medications: 'Metformin 500mg',
      attendingPhysician: 'Dr. Santos',
      emergencyContactName: 'Cristy Navarro', emergencyContactNumber: '0918 444 6666',
      glucose: 175, bp: '126/82', weight: 70, temp: 36.7, bmi: 24.2,
      source: 'app', time: '—', flagged: false, missedToday: true,
      referral: 'none', visitCount: 3,
      history: [
        { datetime: 'Aug 5, 2026 10:30 AM', glucose: 175, bp: '126/82', status: 'normal', source: 'app' },
        { datetime: 'Aug 1, 2026 10:00 AM', glucose: 168, bp: '124/80', status: 'normal', source: 'app' },
        { datetime: 'Jul 27, 2026 9:45 AM', glucose: 160, bp: '122/79', status: 'normal', source: 'app' },
      ],
    },
    /* BHW-submitted patients awaiting BHN approval — mirrors the app's
       own pending-patient workflow exactly (same status field, same
       "no path to Approved yet" gap this closes). Reusing the same
       demo name as the app's own pending-patient example so a reviewer
       flipping between app and website recognizes it as the same
       underlying scenario, not two unrelated pieces of sample data.

       These carry REGISTRATION fields only — first/middle/last name,
       DOB, address, purok, contact, diabetes type, diagnosis date,
       medications, physician, emergency contact — matching exactly
       what the app's own Add New Patient form collects. No glucose/BP/
       weight/temp: a patient this new has no health record yet, since
       the app itself won't let a BHW log one until the patient is
       approved. Giving them fake vitals here would misrepresent what
       a BHN is actually approving — a person's registration details,
       not a reading. */
    {
      id: 'P-0015', status: 'pending',
      firstName: 'John Mark', middleName: 'C.', lastName: 'Idanan',
      initials: 'JI', color: '#64748b',
      dob: 'Mar 14, 1970', age: 56, sex: 'Male',
      address: '12 Mabini St.', barangay: 'San Jose', purok: 'Purok 4',
      contactNumber: '0917 234 5678',
      diabetesType: 'Type 2', diagnosisDate: 'Not specified',
      medications: 'Metformin 500mg', attendingPhysician: 'Not specified',
      emergencyContactName: 'Elena Idanan', emergencyContactNumber: '0917 234 9012',
      source: 'app', time: '7:50 AM', flagged: false, missedToday: false,
      referral: 'none', visitCount: 0, history: [],
    },
    {
      id: 'P-0016', status: 'pending',
      firstName: 'Corazon', middleName: '', lastName: 'Ibarra',
      initials: 'CI', color: '#64748b',
      dob: 'Jun 2, 1966', age: 60, sex: 'Female',
      address: '45 Rizal St.', barangay: 'Bonbon', purok: 'Purok 2',
      contactNumber: '0918 345 6789',
      diabetesType: 'Type 2', diagnosisDate: 'Jan 10, 2024',
      medications: 'Glipizide 5mg', attendingPhysician: 'Dr. Ramos',
      emergencyContactName: 'Pedro Ibarra', emergencyContactNumber: '0918 345 0123',
      source: 'app', time: '8:05 AM', flagged: false, missedToday: false,
      referral: 'none', visitCount: 0, history: [],
    },
  ];

  /* Attach computed risk score/level/trend once, here, so every
     consumer sees the same classification for the same patient. */
  const APPROVAL_KEY = 'diacare_pending_approvals_v1'; // { [id]: 'approved' | 'rejected' }

  function loadApprovals() {
    try {
      const raw = localStorage.getItem(APPROVAL_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveApproval(id, decision) {
    const map = loadApprovals();
    map[id] = decision;
    try { localStorage.setItem(APPROVAL_KEY, JSON.stringify(map)); } catch { /* private browsing */ }
  }

  const approvals = loadApprovals();

  const SCORED_ALL = RAW_PATIENTS.map(p => {
    const score = calcScore(p.glucose, p.bp);
    const level = scoreToLevel(score);
    const asc = [...p.history].map(h => h.glucose).reverse(); // oldest -> newest
    let trend = 'stable';
    if (asc.length >= 3) {
      const diff1 = asc[1] - asc[0];
      const diff2 = asc[2] - asc[1];
      trend = (diff1 > 5 && diff2 > 5) ? 'worsening' :
        (diff1 < -5 && diff2 < -5) ? 'improving' : 'stable';
    }
    // A pending patient approved in a previous session should show as
    // active on this load; a rejected one is dropped entirely, same as
    // if a BHN had declined it on the app side.
    let status = p.status || 'active';
    if (status === 'pending' && approvals[p.id] === 'approved') status = 'active';
    if (status === 'pending' && approvals[p.id] === 'rejected') status = 'rejected';
    /* missedToday patients are flagged for follow-up by attendance,
       not by vitals — keep their vitals-based risk level for the
       table/report views, but alerts.js treats them as their own
       category regardless of this level. */
    // Every other page on the site reads a single p.name field — the
    // pending patients above are entered as firstName/middleName/
    // lastName (matching the app's own registration form exactly), so
    // derive the combined name here once, rather than needing every
    // consumer to special-case patients that don't have a plain
    // "name" field.
    const name = p.name || [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
    return { ...p, name, status, risk: level, score, trend };
  }).filter(p => p.status !== 'rejected');

  /* Same split the app itself uses: PATIENTS is the active/approved
     roster every existing page (Dashboard, Reports, Alerts, Risk
     Analysis, Patient Monitoring's main table) already reads from —
     none of them needed to change to correctly exclude patients still
     awaiting approval. PENDING_PATIENTS is the new queue Patient
     Monitoring's approval section reads from. */
  const PATIENTS = SCORED_ALL.filter(p => p.status !== 'pending');
  const PENDING_PATIENTS = SCORED_ALL.filter(p => p.status === 'pending');

  /* ── Flag for Follow-up — shared between Patient Monitoring's own
     Flag button and the High-Risk Alerts flag modal, so flagging a
     patient from either page reflects everywhere else instead of each
     page keeping its own disconnected, unpersisted flag state. ── */
  const FLAG_KEY = 'diacare_flagged_patients_v1'; // { [id]: { reason, notes } | true }

  function loadFlags() {
    try {
      const raw = localStorage.getItem(FLAG_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveFlags(map) {
    try { localStorage.setItem(FLAG_KEY, JSON.stringify(map)); } catch { /* private browsing */ }
  }

  const savedFlags = loadFlags();
  PATIENTS.forEach(p => {
    const f = savedFlags[p.id];
    p.flagged = !!f;
    p.flagReason = f && typeof f === 'object' ? f.reason : undefined;
    p.flagNotes = f && typeof f === 'object' ? f.notes : undefined;
  });

  function setPatientFlag(patientId, flagged, meta) {
    const map = loadFlags();
    if (flagged) map[patientId] = meta || true;
    else delete map[patientId];
    saveFlags(map);

    const patient = PATIENTS.find(p => p.id === patientId);
    if (patient) {
      patient.flagged = flagged;
      patient.flagReason = flagged ? meta?.reason : undefined;
      patient.flagNotes = flagged ? meta?.notes : undefined;
    }
    return patient;
  }

  function approvePatient(id) {
    saveApproval(id, 'approved');
    const idx = PENDING_PATIENTS.findIndex(p => p.id === id);
    if (idx !== -1) {
      const [p] = PENDING_PATIENTS.splice(idx, 1);
      p.status = 'active';
      PATIENTS.push(p);
    }
  }

  function rejectPatient(id) {
    saveApproval(id, 'rejected');
    const idx = PENDING_PATIENTS.findIndex(p => p.id === id);
    if (idx !== -1) PENDING_PATIENTS.splice(idx, 1);
  }

  /* Manually-encoded patients (Patient Encoding / "Plan B") — persisted
     to localStorage so they survive navigation to Dashboard, Patient
     Monitoring, Reports, etc., instead of only existing in the memory
     of the tab that encoded them. There's still no backend, so this is
     the closest a client-only mock can get to "the encoded patient
     shows up everywhere else on the site"; once a real API exists,
     addEncodedPatient() below is the one place that needs to change to
     POST instead of writing to localStorage. */
  const ENCODED_KEY = 'diacare_encoded_patients_v1';

  function loadEncodedPatients() {
    try {
      const raw = localStorage.getItem(ENCODED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return []; // private browsing / quota exceeded — just start empty
    }
  }

  function scorePatient(p) {
    const score = calcScore(p.glucose, p.bp);
    return {
      ...p,
      risk: scoreToLevel(score), score, trend: 'stable',
      history: p.history || [],
      // Encoded patients don't come with these fields (they're specific
      // to the app/mock-roster shape) — default them so Reports/Alerts/
      // Patient Monitoring, which all expect them to exist, don't show
      // "undefined" or silently misbehave for a manually-encoded patient.
      visitCount: p.visitCount ?? 1,
      missedToday: p.missedToday ?? false,
      flagged: p.flagged ?? false,
    };
  }

  loadEncodedPatients().forEach(p => PATIENTS.push(scorePatient(p)));

  /* Called by patient-encoding.js after a successful save — appends to
     the in-memory roster (so anything already rendered on *this* page
     can react immediately) and persists to localStorage (so every other
     page picks it up on its next load). */
  function addEncodedPatient(patient) {
    const stored = loadEncodedPatients();
    stored.push(patient);
    try {
      localStorage.setItem(ENCODED_KEY, JSON.stringify(stored));
    } catch {
      /* private browsing / quota exceeded — patient still shows up for
         the rest of this session via the in-memory push below, just
         won't survive a reload or be visible on another page/tab. */
    }
    const scored = scorePatient(patient);
    PATIENTS.push(scored);
    return scored;
  }

  /* ================================================================
     VISITS FOR EXISTING PATIENTS — Patient Encoding's "Existing
     Patient" mode calls addVisitToPatient() instead of
     addEncodedPatient() when the RHU Nurse is logging a follow-up for
     someone already in the roster (registered by a BHW, or a prior
     encoding), so it appends a history entry to that person instead
     of creating a duplicate patient with a second ID.
     ================================================================ */
  const VISITS_KEY = 'diacare_patient_visits_v1';

  function loadVisits() {
    try {
      const raw = localStorage.getItem(VISITS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function computeTrend(history) {
    const asc = [...history].map(h => h.glucose).reverse(); // oldest -> newest
    if (asc.length < 3) return 'stable';
    const diff1 = asc[1] - asc[0];
    const diff2 = asc[2] - asc[1];
    return (diff1 > 5 && diff2 > 5) ? 'worsening' :
      (diff1 < -5 && diff2 < -5) ? 'improving' : 'stable';
  }

  /* Mutates `patient` in place: prepends the new history entry (newest
     first, matching every existing patient's history ordering) and
     refreshes the top-level "latest reading" fields that Dashboard,
     Patient Monitoring, Alerts, and Reports all read directly instead
     of digging into history[0] themselves. */
  function applyVisitToPatient(patient, visit) {
    patient.history = [visit, ...(patient.history || [])];
    patient.glucose = visit.glucose;
    patient.bp = visit.bp;
    if (visit.weight) patient.weight = visit.weight;
    if (visit.height) patient.height = visit.height;
    if (visit.bmi) patient.bmi = visit.bmi;
    patient.source = visit.source;
    patient.time = visit.time;
    patient.referral = visit.referral;
    patient.visitCount = (patient.visitCount || 0) + 1;
    const score = calcScore(patient.glucose, patient.bp);
    patient.score = score;
    patient.risk = scoreToLevel(score);
    patient.trend = computeTrend(patient.history);
    return patient;
  }

  loadVisits().forEach(({ patientId, ...visit }) => {
    const patient = PATIENTS.find(p => p.id === patientId);
    if (patient) applyVisitToPatient(patient, visit);
  });

  /* Called by patient-encoding.js's "Existing Patient" mode after a
     successful save. Persists just the new visit, not the whole
     patient — mirrors how addEncodedPatient() persists new patients,
     just for an update to an existing one instead of a creation. */
  function addVisitToPatient(patientId, visit) {
    const stored = loadVisits();
    stored.push({ patientId, ...visit });
    try {
      localStorage.setItem(VISITS_KEY, JSON.stringify(stored));
    } catch {
      /* private browsing / quota exceeded — still applied in-memory
         below for the rest of this session, just won't survive a
         reload or be visible on another page/tab. */
    }
    const patient = PATIENTS.find(p => p.id === patientId);
    if (patient) applyVisitToPatient(patient, visit);
    return patient;
  }

  /* Per-barangay rollup used by Reports and Risk Analysis, derived
     from the same roster instead of independently hardcoded numbers. */
  function getBarangaySummary() {
    return BARANGAYS.map(name => {
      const pts = PATIENTS.filter(p => p.barangay === name);
      const n = pts.length;
      // Only average over patients who actually have a logged reading —
      // an approved patient with no health record yet (a real, valid
      // state: the app won't let a BHW log one until approval) has no
      // glucose/BP to average, and previously crashed this whole
      // function the moment one existed.
      const withVitals = pts.filter(p => p.glucose && p.bp);
      const vn = withVitals.length;
      const avgGlucose = vn ? Math.round(withVitals.reduce((s, p) => s + p.glucose, 0) / vn) : 0;
      const bpParts = withVitals.map(p => p.bp.split('/').map(Number));
      const avgSys = vn ? Math.round(bpParts.reduce((s, b) => s + b[0], 0) / vn) : 0;
      const avgDia = vn ? Math.round(bpParts.reduce((s, b) => s + b[1], 0) / vn) : 0;
      const highRisk = pts.filter(p => p.risk === 'critical').length;
      const atRisk = pts.filter(p => p.risk === 'warning').length;
      const normal = pts.filter(p => p.risk === 'normal').length;
      const referrals = pts.filter(p => p.referral && p.referral !== 'none').length;
      return {
        name, patients: n, avgGlucose, avgSys, avgDia,
        avgBP: vn ? `${avgSys}/${avgDia}` : '—',
        highRisk, atRisk, normal, referrals,
      };
    });
  }

  window.DiaCarePatients = {
    PATIENTS,
    PENDING_PATIENTS,
    BARANGAYS,
    getBarangaySummary,
    addEncodedPatient,
    addVisitToPatient,
    setPatientFlag,
    approvePatient,
    rejectPatient,
    calcScore,
    scoreToLevel,
    sourceToVisitLabel,
  };
})();
