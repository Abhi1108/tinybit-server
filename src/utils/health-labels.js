/** Shared display labels for profile medical_conditions / medicine frequency codes. */

const CONDITION_LABELS = {
  none: null,
  diabetes: 'Diabetes',
  pre_diabetes: 'Pre-Diabetes',
  cholesterol: 'High Cholesterol',
  hypertension: 'Hypertension',
  pcos: 'PCOS',
  thyroid: 'Thyroid Disorder',
  physical_injury: 'Physical Injury',
  stress_anxiety: 'Stress / Anxiety',
  sleep_issues: 'Sleep Issues',
  depression: 'Depression',
  anger_issues: 'Anger Issues',
  loneliness: 'Loneliness',
  relationship_stress: 'Relationship Stress',
  others: 'Other',
};

const FREQUENCY_LABELS = {
  once: 'Daily',
  twice: 'Twice Daily',
  thrice: 'Three Times Daily',
  four_times: 'Four Times Daily',
  as_needed: 'As Needed',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function resolveMedicineTime(m) {
  if (m.time) return m.time;
  if (m.schedule_time === 'Morning') return '8:00 AM';
  if (m.schedule_time === 'Afternoon') return '12:00 PM';
  if (m.schedule_time === 'Night' || m.schedule_time === 'Evening') return '8:00 PM';
  return '';
}

function formatConditionLabels(rawConditions, otherCondition) {
  const labels = (Array.isArray(rawConditions) ? rawConditions : [])
    .filter((c) => c !== 'none')
    .map((c) => (CONDITION_LABELS[c] !== undefined ? CONDITION_LABELS[c] : c))
    .filter(Boolean);
  if (otherCondition && String(otherCondition).trim()) {
    labels.push(String(otherCondition).trim());
  }
  return labels;
}

module.exports = {
  CONDITION_LABELS,
  FREQUENCY_LABELS,
  resolveMedicineTime,
  formatConditionLabels,
};
