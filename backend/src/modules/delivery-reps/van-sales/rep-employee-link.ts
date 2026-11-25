import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { VanRepEmployeeLinkService } from '../services/van-rep-employee-link.service';

export class RepEmployeeLinkService {
  constructor(private readonly getRepEmployeeLink: () => VanRepEmployeeLinkService) {}
  /**
   * Link delivery representative to an HR employee.
   */
  async linkRepToEmployee(tenantId: string, repId: number, employeeId: number | null) {
    return this.getRepEmployeeLink().linkRepToEmployee(tenantId, repId, employeeId);
  }

  /**
   * List active candidate HR employees for linking to delivery representatives.
   */
  async listCandidateEmployees(tenantId: string) {
    return this.getRepEmployeeLink().listCandidateEmployees(tenantId);
  }

  /**
   * Automatically create an HR employee record for a delivery representative and link them.
   */
  async autoCreateEmployeeForRep(tenantId: string, accountId: string, repId: number, authContext: AuthContext) {
    return this.getRepEmployeeLink().autoCreateEmployeeForRep(tenantId, accountId, repId, authContext);
  }
}
