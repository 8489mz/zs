import { useTranslation } from 'react-i18next';
import React from 'react';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import type { IssueOrderDestinationOption } from './issue-order-destination.helpers';

const ISSUE_MODE_OPTIONS = [
  { value: 'final_issue', label: 'صرف نهائي (يتم خصم الرصيد فوراً)' },
  { value: 'transfer_to_branch_stock', label: 'تحويل إلى رصيد فرع (يبقى في الطريق حتى يتم استلامه)' },
];

interface IssueOrderHeaderSectionProps {
  fromLocationQuery: string;
  setFromLocationQuery: (q: string) => void;
  setFromLocationId: (id: string) => void;
  toLocationQuery: string;
  setToLocationQuery: (q: string) => void;
  onSelectDestination: (option: IssueOrderDestinationOption) => void;
  onClearDestination: () => void;
  locationOptions: { id: string; name: string; searchTerms: string }[];
  destinationOptions: IssueOrderDestinationOption[];
  issueMode: 'final_issue' | 'transfer_to_branch_stock';
  setIssueMode: (mode: 'final_issue' | 'transfer_to_branch_stock') => void;
  dispatcherName: string;
  recipientName: string;
  setRecipientName: (name: string) => void;
}

export const IssueOrderHeaderSection: React.FC<IssueOrderHeaderSectionProps> = ({
  fromLocationQuery,
  setFromLocationQuery,
  setFromLocationId,
  toLocationQuery,
  setToLocationQuery,
  onSelectDestination,
  onClearDestination,
  locationOptions,
  destinationOptions,
  issueMode,
  setIssueMode,
  dispatcherName,
  recipientName,
  setRecipientName,
}) => {
  const { t } = useTranslation();
  return (
    <section className="document-prototype-section" style={{ background: '#ffffff', borderRadius: '10px', border: '1px solid #cbd5e1', padding: '14px 16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ width: '3.5px', height: '14px', background: '#2563eb', borderRadius: '2px' }} />
        <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: '#0f172a' }}>{t('inventory.issue_order.issue_order_header_section.s0', "المعلومات الأساسية")}</h3>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Row 1: Source Warehouse, Destination Branch & Issue Mode (3 columns on 1 line) */}
        <div className="product-form-grid-3">
          <SearchableCombobox
            label={t('inventory.issue_order.issue_order_header_section.s1', "من مخزن (مخزن الصرف)")}
            placeholder={t('inventory.issue_order.issue_order_header_section.s2', "اختر المخزن...")}
            value={fromLocationQuery}
            onChange={(q) => {
              setFromLocationQuery(q);
              if (!q) setFromLocationId('');
            }}
            onSelect={(l) => setFromLocationId(l.id)}
            options={locationOptions}
            search={(l, q) => l.searchTerms.includes(q.toLowerCase())}
            getLabel={(l) => l.name}
            createLabel={(q) => `إضافة "${q}"`}
            inputClassName="purchase-prototype-field-input"
          />

          <SearchableCombobox
            label={t('inventory.issue_order.issue_order_header_section.s3', "إلى فرع أو مخزن (المستلم)")}
            placeholder={t('inventory.issue_order.issue_order_header_section.s4', "اختر الفرع أو المخزن...")}
            value={toLocationQuery}
            onChange={(q) => {
              setToLocationQuery(q);
              if (!q) onClearDestination();
            }}
            onSelect={(l) => onSelectDestination(l)}
            options={destinationOptions}
            search={(l, q) => l.searchTerms.includes(q.toLowerCase())}
            getLabel={(l) => l.name}
            createLabel={(q) => `إضافة "${q}"`}
            inputClassName="purchase-prototype-field-input"
          />

          <Field label={t('inventory.issue_order.issue_order_header_section.s5', "وضع الصرف")}>
            <CustomSelect
              value={issueMode}
              onChange={(val) => setIssueMode(val as any)}
              options={ISSUE_MODE_OPTIONS}
              placeholder={t('inventory.issue_order.issue_order_header_section.s6', "اختر وضع الصرف")}
            />
          </Field>
        </div>

        {/* Row 2: Dispatcher & Recipient (2 columns) */}
        <div className="product-form-grid-2">
          <Field label={t('inventory.issue_order.issue_order_header_section.s7', "مسئول الصرف")}>
            <input
              type="text"
              className="purchase-prototype-field-input purchase-prototype-readonly-input"
              value={dispatcherName}
              readOnly
              disabled
            />
          </Field>

          <Field label={t('inventory.issue_order.issue_order_header_section.s8', "اسم المستلم / السائق")}>
            <input
              type="text"
              className="purchase-prototype-field-input"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder={t('inventory.issue_order.issue_order_header_section.s9', "اكتب اسم المستلم هنا...")}
            />
          </Field>
        </div>
      </div>
    </section>
  );
};
