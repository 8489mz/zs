import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { deliveryRepsApi, type DeliveryRep } from '@/shared/api/delivery-reps.api';
import { hrApi } from '@/features/hr/api/hr.api';

import { systemAlert } from '@/shared/components/system-alert';
import { validatePasscode } from '@/shared/utils/passcode-validator';
import type { HrEmployee } from '@/types/domain';
import { DeliveryRepsHeader } from './unified-access-directory-panel/delivery-reps-header';
import { DeliveryRepsFilters } from './unified-access-directory-panel/delivery-reps-filters';
import { DeliveryRepsTable } from './unified-access-directory-panel/delivery-reps-table';
import { DeliveryRepsEditModal } from './unified-access-directory-panel/delivery-reps-edit-modal';
import { DeliveryRepsUpsertModal } from './unified-access-directory-panel/delivery-reps-upsert-modal';
import { EmployeeSelfServiceHeader } from './unified-access-directory-panel/employee-self-service-header';
import { EmployeeSelfServiceFilters } from './unified-access-directory-panel/employee-self-service-filters';
import { EmployeeSelfServiceTable } from './unified-access-directory-panel/employee-self-service-table';
import { EmployeeSelfServiceEditModal } from './unified-access-directory-panel/employee-self-service-edit-modal';

// ----------------------------------------------------------------------
// 1. Delivery Reps & Van Sales Access Panel
// ----------------------------------------------------------------------

export function DeliveryRepsAccessPanel() {
  const { t: __t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Edit Credentials Modal
  const [editingRep, setEditingRep] = useState<DeliveryRep | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [showRepPassword, setShowRepPassword] = useState(false);

  // Full Upsert Modal
  const [isUpsertOpen, setIsUpsertOpen] = useState(false);
  const [upsertRep, setUpsertRep] = useState<DeliveryRep | null>(null);

  // Primary Source Query (Shares cache key with /delivery-reps)
  const repsQuery = useQuery({
    queryKey: ['delivery-reps'],
    queryFn: deliveryRepsApi.list,
  });

  const repsList = repsQuery.data || [];

  // Filtered List
  const filteredReps = useMemo(() => {
    return repsList.filter((rep) => {
      if (statusFilter === 'active' && !rep.is_active) return false;
      if (statusFilter === 'inactive' && rep.is_active) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matchesName = (rep.name || '').toLowerCase().includes(q);
        const matchesFull = (rep.full_name || '').toLowerCase().includes(q);
        const matchesPhone = (rep.phone || '').toLowerCase().includes(q);
        return matchesName || matchesFull || matchesPhone;
      }
      return true;
    });
  }, [repsList, searchTerm, statusFilter]);

  // Primary Source Mutations
  const updateMutation = useMutation({
    mutationFn: (data: { id: number; payload: Partial<DeliveryRep> & { pinCode?: string } }) =>
      deliveryRepsApi.update(data.id, data.payload as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-reps'] });
      setEditingRep(null);
      systemAlert('تم تحديث بيانات الدخول للمندوب بنجاح');
    },
    onError: (error: any) => {
      systemAlert(error.message || 'حدث خطأ أثناء التحديث');
    },
  });

  const toggleActive = (rep: DeliveryRep) => {
    updateMutation.mutate({
      id: rep.id,
      payload: {
        name: rep.name,
        isActive: !rep.is_active,
      } as any,
    });
  };

  const handleSaveCredentials = () => {
    if (!editingRep) return;
    const cleanPin = pinInput.trim();
    const cleanPhone = phoneInput.trim();
    if (cleanPin) {
      const check = validatePasscode(cleanPin, { phone: cleanPhone });
      if (!check.valid) {
        systemAlert(check.error || 'رمز الدخول غير صالح');
        return;
      }
    }
    updateMutation.mutate({
      id: editingRep.id,
      payload: {
        name: editingRep.name,
        phone: cleanPhone || undefined,
        pinCode: cleanPin || undefined,
      },
    });
  };

  const copyUrl = (path: string, label: string) => {
    const url = window.location.origin + path;
    navigator.clipboard.writeText(url);
    systemAlert(`تم نسخ رابط ${label} إلى الحافظة:\n${url}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <DeliveryRepsHeader
        __t={__t}
        setUpsertRep={setUpsertRep}
        setIsUpsertOpen={setIsUpsertOpen}
        navigate={navigate}
      />

      <DeliveryRepsFilters
        __t={__t}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        repsList={repsList}
        setStatusFilter={setStatusFilter}
        statusFilter={statusFilter}
      />

      <DeliveryRepsTable
        __t={__t}
        repsQuery={repsQuery}
        filteredReps={filteredReps}
        copyUrl={copyUrl}
        setUpsertRep={setUpsertRep}
        setIsUpsertOpen={setIsUpsertOpen}
        setEditingRep={setEditingRep}
        setPhoneInput={setPhoneInput}
        setPinInput={setPinInput}
        setShowRepPassword={setShowRepPassword}
        toggleActive={toggleActive}
        updateMutation={updateMutation}
      />

      <DeliveryRepsEditModal
        editingRep={editingRep}
        setEditingRep={setEditingRep}
        __t={__t}
        phoneInput={phoneInput}
        setPhoneInput={setPhoneInput}
        setShowRepPassword={setShowRepPassword}
        showRepPassword={showRepPassword}
        pinInput={pinInput}
        setPinInput={setPinInput}
        handleSaveCredentials={handleSaveCredentials}
        updateMutation={updateMutation}
      />

      <DeliveryRepsUpsertModal
        isUpsertOpen={isUpsertOpen}
        setIsUpsertOpen={setIsUpsertOpen}
        setUpsertRep={setUpsertRep}
        upsertRep={upsertRep}
      />
    </div>
  );
}


// ----------------------------------------------------------------------
// 2. Self-Service Employees & Mobile Punch Access Panel
// ----------------------------------------------------------------------

export function EmployeeSelfServiceAccessPanel() {
  const { t: __t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal State
  const [editingEmployee, setEditingEmployee] = useState<HrEmployee | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [showEmployeePassword, setShowEmployeePassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Primary Source Query (Shares cache key with HR module)
  const employeesQuery = useQuery({
    queryKey: ['hr', 'employees', 'access-directory'],
    queryFn: () => hrApi.employees({ page: 1, pageSize: 200 }),
  });

  const rawEmployees = employeesQuery.data?.employees || [];

  // Filtered List
  const filteredEmployees = useMemo(() => {
    return rawEmployees.filter((emp) => {
      const isEmpActive = String(emp.status || '') === 'active';
      if (statusFilter === 'active' && !isEmpActive) return false;
      if (statusFilter === 'inactive' && isEmpActive) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const name = `${emp.displayName || ''} ${emp.firstName || ''} ${emp.lastName || ''}`.toLowerCase();
        const empNo = String(emp.employeeNo || '').toLowerCase();
        const phone = String(emp.mobile || emp.phone || '').toLowerCase();
        return name.includes(q) || empNo.includes(q) || phone.includes(q);
      }
      return true;
    });
  }, [rawEmployees, searchTerm, statusFilter]);

  // Primary Source Mutation: Set Employee Credentials (Phone & PIN)
  const handleSaveCredentials = async () => {
    if (!editingEmployee || !editingEmployee.id) return;
    const cleanPin = pinInput.trim();
    const cleanPhone = phoneInput.trim();

    if (cleanPin) {
      const check = validatePasscode(cleanPin, { phone: cleanPhone, identifier: editingEmployee.employeeNo });
      if (!check.valid) {
        systemAlert(check.error || 'رمز الدخول غير صالح');
        return;
      }
    }

    if (!cleanPhone && !cleanPin) {
      systemAlert('يرجى إدخال رقم الهاتف أو رمز كلمة المرور على الأقل');
      return;
    }

    setIsSubmitting(true);
    try {
      await hrApi.updateEmployeeCredentials(String(editingEmployee.id), {
        phone: cleanPhone || undefined,
        pinCode: cleanPin || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['hr'] });
      systemAlert(`تم تحديث بيانات وصول الموظف ${editingEmployee.displayName || editingEmployee.firstName} بنجاح`);
      setEditingEmployee(null);
    } catch (err: any) {
      systemAlert(err.message || 'حدث خطأ أثناء حفظ البيانات');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Primary Source Mutation: Toggle Employee Status (active / deactivated)
  const toggleEmployeeStatus = async (emp: HrEmployee) => {
    const isCurrentlyActive = String(emp.status || '') === 'active';
    const nextStatus = isCurrentlyActive ? 'deactivated' : 'active';
    try {
      await hrApi.updateEmployeeStatus(String(emp.id), nextStatus);
      await queryClient.invalidateQueries({ queryKey: ['hr'] });
      systemAlert(`تم ${isCurrentlyActive ? 'إيقاف حساب' : 'تفعيل'} الموظف بنجاح`);
    } catch (err: any) {
      systemAlert(err.message || 'حدث خطأ أثناء تعديل حالة الموظف');
    }
  };

  const copyUrl = (path: string, label: string) => {
    const url = window.location.origin + path;
    navigator.clipboard.writeText(url);
    systemAlert(`تم نسخ رابط ${label} إلى الحافظة:\n${url}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <EmployeeSelfServiceHeader
        __t={__t}
        navigate={navigate}
      />

      <EmployeeSelfServiceFilters
        __t={__t}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        rawEmployees={rawEmployees}
        setStatusFilter={setStatusFilter}
        statusFilter={statusFilter}
      />

      <EmployeeSelfServiceTable
        __t={__t}
        employeesQuery={employeesQuery}
        filteredEmployees={filteredEmployees}
        copyUrl={copyUrl}
        setEditingEmployee={setEditingEmployee}
        setPhoneInput={setPhoneInput}
        setPinInput={setPinInput}
        setShowEmployeePassword={setShowEmployeePassword}
        toggleEmployeeStatus={toggleEmployeeStatus}
        navigate={navigate}
      />

      <EmployeeSelfServiceEditModal
        editingEmployee={editingEmployee}
        setEditingEmployee={setEditingEmployee}
        __t={__t}
        phoneInput={phoneInput}
        setPhoneInput={setPhoneInput}
        setShowEmployeePassword={setShowEmployeePassword}
        showEmployeePassword={showEmployeePassword}
        pinInput={pinInput}
        setPinInput={setPinInput}
        handleSaveCredentials={handleSaveCredentials}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
