export const TRADE_LABELS: Record<string, string> = {
  civil_concrete: 'الأعمال المدنية والخرسانات',
  masonry_insulation: 'أعمال المباني والعزل',
  finishes: 'أعمال التشطيبات والديكور',
  doors_windows_facades: 'النجارة والألوميتال والواجهات',
  steel_structures: 'الإنشاءات المعدنية',
  electrical: 'أعمال الكهرباء والإنارة',
  smart_systems_elv: 'التيار الخفيف والسمارت',
  plumbing: 'الأعمال الصحية والسباكة',
  hvac_firefighting: 'التكييف ومكافحة الحريق',
  landscape_infrastructure: 'الموقع العام واللاندسكيب',
  earthworks: 'أعمال الحفر والردم',
  concrete: 'الخرسانات المسلحة',
  masonry: 'أعمال المباني',
  mep: 'الكهروميكانيك',
  architecture_finishes: 'أعمال التشطيبات والمعماري',
  plumbing_sanitary: 'الأعمال الصحية والتغذية',
  electrical_power: 'أعمال الكهرباء والإنارة',
  general: 'أعمال عامة',
  other: 'أعمال عامة',
};

// Safe number parser to prevent any NaN from breaking the UI
export const getNum = (val: any): number => {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
};
