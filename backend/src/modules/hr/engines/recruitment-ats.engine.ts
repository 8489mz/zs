/**
 * Pure calculation & pipeline validation engine for Recruitment ATS & Talent Pools.
 * Fully isolated from database and framework dependencies.
 */

export type ApplicantStage = 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';

const STAGE_ORDER: Record<ApplicantStage, number> = {
  new: 1,
  screening: 2,
  interview: 3,
  offer: 4,
  hired: 5,
  rejected: 99,
};

/**
 * Validates whether an applicant can transition from currentStage to nextStage.
 * Candidates can be rejected from any stage.
 * Candidates cannot move backwards once hired.
 */
export function validateStageTransition(
  currentStage: ApplicantStage,
  nextStage: ApplicantStage,
): { valid: boolean; reason?: string } {
  if (currentStage === nextStage) {
    return { valid: true };
  }

  if (nextStage === 'hired' && currentStage !== 'hired') {
    return { valid: false, reason: 'يجب استخدام إجراء التعيين الرسمي لإنشاء ملف الموظف والعقد' };
  }

  if (currentStage === 'hired') {
    return {
      valid: false,
      reason: 'لا يمكن تعديل مرحلة مرشح تم توظيفه وتحويله بالفعل إلى موظف رسمي',
    };
  }

  // Any stage can transition to rejected
  if (nextStage === 'rejected') {
    return { valid: true };
  }

  // Re-activating a rejected applicant
  if (currentStage === 'rejected') {
    return { valid: true };
  }

  return { valid: true };
}

/**
 * Checks if a job opening has available capacity for more hires
 */
export function checkJobOpeningHeadcount(
  headcount: number,
  currentHiredCount: number,
): { canHire: boolean; remainingSlots: number; shouldCloseJob: boolean } {
  const safeHeadcount = Math.max(1, Number(headcount) || 1);
  const safeHired = Math.max(0, Number(currentHiredCount) || 0);

  const remainingSlots = Math.max(0, safeHeadcount - safeHired);
  const canHire = remainingSlots > 0;
  const shouldCloseJob = safeHired + 1 >= safeHeadcount;

  return {
    canHire,
    remainingSlots,
    shouldCloseJob,
  };
}

/**
 * Maps hired applicant attributes into official employee creation payload
 */
export function buildEmployeeFromApplicant(
  applicant: {
    fullName: string;
    phone: string;
    email?: string | null;
    expectedSalary?: number | null;
  },
  job: {
    title: string;
    department: string;
  },
  customSalary?: number,
): {
  name: string;
  phone: string;
  email: string | null;
  position: string;
  department: string;
  basic_salary: number;
} {
  const salary = customSalary !== undefined ? customSalary : Number(applicant.expectedSalary || 0);

  return {
    name: applicant.fullName.trim(),
    phone: applicant.phone.trim(),
    email: applicant.email?.trim() || null,
    position: job.title.trim(),
    department: job.department.trim(),
    basic_salary: Math.max(0, salary),
  };
}

/**
 * Computes recruitment recruitment pipeline funnel counts
 */
export function calculateRecruitmentFunnel(applicants: Array<{ stage: string }>): {
  newCount: number;
  screeningCount: number;
  interviewCount: number;
  offerCount: number;
  hiredCount: number;
  rejectedCount: number;
  totalApplicants: number;
  conversionRatePercent: number;
} {
  const funnel = {
    newCount: 0,
    screeningCount: 0,
    interviewCount: 0,
    offerCount: 0,
    hiredCount: 0,
    rejectedCount: 0,
  };

  for (const a of applicants) {
    switch (a.stage) {
      case 'new':
        funnel.newCount++;
        break;
      case 'screening':
        funnel.screeningCount++;
        break;
      case 'interview':
        funnel.interviewCount++;
        break;
      case 'offer':
        funnel.offerCount++;
        break;
      case 'hired':
        funnel.hiredCount++;
        break;
      case 'rejected':
        funnel.rejectedCount++;
        break;
      default:
        break;
    }
  }

  const totalApplicants = applicants.length;
  const conversionRatePercent = totalApplicants > 0 ? Math.round((funnel.hiredCount / totalApplicants) * 1000) / 10 : 0;

  return {
    ...funnel,
    totalApplicants,
    conversionRatePercent,
  };
}
