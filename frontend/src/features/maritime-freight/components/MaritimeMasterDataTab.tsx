import { useTranslation } from 'react-i18next';
import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ShippingPort,
  ShippingLine,
  ReferenceDataResponse,
  maritimeApi,
} from '../api/maritime-freight.api';
import { Field } from '@/shared/ui/field';
import { AppIcons, XIcon } from '@/shared/components/icons/AppIcons';
import { PartnerFormModal } from './PartnerFormModal';
import { ImportCarriersModal } from './ImportCarriersModal';
import { MasterDataTabsBar } from './master-data/MasterDataTabsBar';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { CustomSelect } from '@/shared/ui/custom-select';
import { useMaritime } from '../context/MaritimeContext';
import { MasterDataHeader } from './master-data/MasterDataHeader';

interface MaritimeMasterDataTabProps {
  ports: ShippingPort[];
  lines: ShippingLine[];
  onRefresh: () => void;
}

const TRADE_LANE_LABELS: Record<string, string> = {
  far_east: 'الصين والشرق الأقصى',
  europe_med: 'أوروبا والمتوسط',
  arabian_gulf: 'الخليج والبحر الأحمر',
  americas: 'الأمريكتين',
  africa: 'أفريقيا',
  indian_sub: 'الهند وجنوب آسيا',
  middle_east: 'الشرق الأوسط',
  black_sea: 'البحر الأسود',
};

const COUNTRY_OPTIONS = [
  { code: 'all', name: 'كافة الدول والمناطق' },
  { code: 'CN', name: 'الصين وشرق آسيا' },
  { code: 'DE', name: 'ألمانيا وأوروبا' },
  { code: 'FR', name: 'فرنسا وأوروبا' },
  { code: 'TR', name: 'تركيا والمتوسط' },
  { code: 'AE', name: 'الإمارات والخليج العربي' },
  { code: 'US', name: 'الولايات المتحدة الأمريكية' },
  { code: 'IN', name: 'الهند وشبه القارة الهندية' },
  { code: 'JP', name: 'اليابان وآسيا' },
  { code: 'SG', name: 'سنغافورة والآسيان' },
];

export function MaritimeMasterDataTab({
  ports,
  lines,
  onRefresh,
}: MaritimeMasterDataTabProps) {
  const { t: __t } = useTranslation();
  const location = useLocation();
  const { pipelineConfig, refreshAll } = useMaritime();
  const enableSeaFreight = pipelineConfig?.enableSeaFreight !== false;
  const enableAirFreight = pipelineConfig?.enableAirFreight !== false;

  const [subTab, setSubTab] = useState<'lines' | 'airlines' | 'agents' | 'ports' | 'airports' | 'standards'>(() => {
    if (!enableSeaFreight && enableAirFreight) return 'airlines';
    return 'lines';
  });

  // Auto-switch subTab if the currently selected transport mode is disabled
  useEffect(() => {
    if (!enableSeaFreight && (subTab === 'lines' || subTab === 'ports')) {
      if (enableAirFreight) {
        setSubTab('airlines');
      } else {
        setSubTab('agents');
      }
    } else if (!enableAirFreight && (subTab === 'airlines' || subTab === 'airports')) {
      if (enableSeaFreight) {
        setSubTab('lines');
      } else {
        setSubTab('agents');
      }
    }
  }, [enableSeaFreight, enableAirFreight, subTab]);
  
  // Search and Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLane, setSelectedLane] = useState('all');
  const [selectedCountry, setSelectedCountry] = useState('all');

  // Modal States
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'shipping_line' | 'overseas_agent' | 'airline' | 'trucking'>('shipping_line');
  const [editingPartner, setEditingPartner] = useState<ShippingLine | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Standards & Reference Data States
  const [referenceData, setReferenceData] = useState<ReferenceDataResponse | null>(null);
  const [isLoadingRefData, setIsLoadingRefData] = useState(false);
  const [standardsSubCategory, setStandardsSubCategory] = useState<'containers' | 'incoterms' | 'terminals'>('containers');
  const [containerCategoryFilter, setContainerCategoryFilter] = useState<'all' | 'dry' | 'reefer' | 'special'>('all');

  // Ensure search input never holds stale or autofilled values when switching tabs or categories
  useEffect(() => {
    setSearchQuery('');
  }, [location.pathname, subTab, standardsSubCategory]);

  useEffect(() => {
    if (subTab === 'standards' && !referenceData && !isLoadingRefData) {
      setIsLoadingRefData(true);
      maritimeApi
        .getReferenceData()
        .then((data) => setReferenceData(data))
        .catch((err) => console.error('Failed to load reference data:', err))
        .finally(() => setIsLoadingRefData(false));
    }
  }, [subTab, referenceData, isLoadingRefData]);

  // New Port Form States
  const [showAddPortForm, setShowAddPortForm] = useState(false);
  const [newPortCode, setNewPortCode] = useState('');
  const [newPortNameAr, setNewPortNameAr] = useState('');
  const [newPortNameEn, setNewPortNameEn] = useState('');
  const [newPortCountryName, setNewPortCountryName] = useState('مصر');
  const [isAddingPort, setIsAddingPort] = useState(false);

  // Separate lists by carrier and port type
  const shippingLinesList = useMemo(() => {
    return lines.filter((l) => !l.carrier_type || l.carrier_type === 'shipping_line');
  }, [lines]);

  const airlinesList = useMemo(() => {
    return lines.filter((l) => l.carrier_type === 'airline');
  }, [lines]);

  const overseasAgentsList = useMemo(() => {
    return lines.filter((l) => l.carrier_type === 'overseas_agent');
  }, [lines]);

  const seaPortsList = useMemo(() => {
    return ports.filter((p) => !p.port_type || p.port_type === 'sea');
  }, [ports]);

  const airPortsList = useMemo(() => {
    return ports.filter((p) => p.port_type === 'air' || p.iata_code);
  }, [ports]);

  // Filtered Shipping Lines
  const filteredLines = useMemo(() => {
    return shippingLinesList.filter((line) => {
      const matchQuery =
        !searchQuery ||
        line.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        line.name_ar.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (line.name_en && line.name_en.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (line.rfq_email && line.rfq_email.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (line.contact_person && line.contact_person.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchLane =
        selectedLane === 'all' ||
        (line.trade_lanes && line.trade_lanes.includes(selectedLane));

      return matchQuery && matchLane;
    });
  }, [shippingLinesList, searchQuery, selectedLane]);

  // Filtered Airlines
  const filteredAirlines = useMemo(() => {
    return airlinesList.filter((line) => {
      const matchQuery =
        !searchQuery ||
        line.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        line.name_ar.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (line.name_en && line.name_en.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (line.airline_prefix && line.airline_prefix.includes(searchQuery)) ||
        (line.rfq_email && line.rfq_email.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (line.contact_person && line.contact_person.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchQuery;
    });
  }, [airlinesList, searchQuery]);

  // Filtered Overseas Agents
  const filteredAgents = useMemo(() => {
    return overseasAgentsList.filter((agent) => {
      const matchQuery =
        !searchQuery ||
        agent.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.name_ar.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (agent.name_en && agent.name_en.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (agent.country_name && agent.country_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (agent.city_name && agent.city_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (agent.contact_person && agent.contact_person.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (agent.rfq_email && agent.rfq_email.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchCountry =
        selectedCountry === 'all' ||
        agent.country_code === selectedCountry ||
        agent.country_name === selectedCountry;

      return matchQuery && matchCountry;
    });
  }, [overseasAgentsList, searchQuery, selectedCountry]);

  // Filtered Ports
  const filteredPorts = useMemo(() => {
    return seaPortsList.filter((port) => {
      return (
        !searchQuery ||
        port.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        port.name_ar.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (port.name_en && port.name_en.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (port.country_name && port.country_name.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    });
  }, [seaPortsList, searchQuery]);

  // Filtered Airports
  const filteredAirports = useMemo(() => {
    return airPortsList.filter((port) => {
      return (
        !searchQuery ||
        port.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        port.name_ar.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (port.name_en && port.name_en.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (port.iata_code && port.iata_code.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (port.country_name && port.country_name.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    });
  }, [airPortsList, searchQuery]);

  // Filtered Containers
  const filteredContainers = useMemo(() => {
    if (!referenceData?.containerTypes) return [];
    return referenceData.containerTypes.filter((c) => {
      const matchCategory =
        containerCategoryFilter === 'all' || c.category === containerCategoryFilter;
      const matchQuery =
        !searchQuery ||
        c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.name_ar.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.name_en.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.description_ar.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCategory && matchQuery;
    });
  }, [referenceData?.containerTypes, containerCategoryFilter, searchQuery]);

  // Filtered Incoterms
  const filteredIncoterms = useMemo(() => {
    if (!referenceData?.incoterms) return [];
    return referenceData.incoterms.filter((inc) => {
      return (
        !searchQuery ||
        inc.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inc.name_ar.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inc.name_en.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inc.description_ar.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inc.risk_transfer_point_ar.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [referenceData?.incoterms, searchQuery]);

  // Filtered Port Terminals
  const filteredTerminals = useMemo(() => {
    if (!referenceData?.portTerminals) return [];
    return referenceData.portTerminals.filter((term) => {
      return (
        !searchQuery ||
        term.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        term.name_ar.toLowerCase().includes(searchQuery.toLowerCase()) ||
        term.name_en.toLowerCase().includes(searchQuery.toLowerCase()) ||
        term.terminal_operator.toLowerCase().includes(searchQuery.toLowerCase()) ||
        term.port_code.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [referenceData?.portTerminals, searchQuery]);

  const handleOpenAdd = (type: 'shipping_line' | 'overseas_agent' | 'airline' | 'trucking') => {
    setEditingPartner(null);
    setModalType(type);
    setModalOpen(true);
  };

  const handleOpenEdit = (partner: ShippingLine) => {
    setEditingPartner(partner);
    setModalType(partner.carrier_type || 'shipping_line');
    setModalOpen(true);
  };

  const handleDeletePartner = async (partner: ShippingLine) => {
    const confirmed = await systemConfirm({
      title: 'حذف شريك من الدليل الملاحي',
      badge: partner.code || partner.name_ar,
      message: `هل أنت متأكد من حذف الشريك "${partner.name_ar}" من الدليل القياسي؟`,
      impactItems: [
        'سيتم استبعاد الخط/الوكيل من قائمة الاختيار السريع في طلبات عروض الأسعار.',
        'يمكنك استعادة الشركاء الافتراضيين في أي وقت عبر زر "استعادة الدليل القياسي".',
      ],
      confirmText: 'حذف الشريك',
      cancelText: 'تراجع',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await maritimeApi.deleteShippingLine(partner.id);
      toast.success(`تم حذف الشريك "${partner.name_ar}" بنجاح`, 'حذف شريك');
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || 'فشل حذف الشريك', 'خطأ');
    }
  };

  const handleAddPort = async () => {
    if (!newPortCode.trim() || !newPortNameAr.trim()) return;
    try {
      setIsAddingPort(true);
      await maritimeApi.createPort({
        code: newPortCode.trim().toUpperCase(),
        nameAr: newPortNameAr.trim(),
        nameEn: newPortNameEn.trim() || newPortNameAr.trim(),
        countryCode: newPortCode.trim().slice(0, 2).toUpperCase() || 'EG',
        countryName: newPortCountryName.trim(),
      });
      setNewPortCode('');
      setNewPortNameAr('');
      setNewPortNameEn('');
      setShowAddPortForm(false);
      toast.success('تمت إضافة الميناء بنجاح', 'إضافة ميناء');
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || 'فشل إضافة الميناء', 'خطأ');
    } finally {
      setIsAddingPort(false);
    }
  };

  const handleCopyEmail = (email: string) => {
    navigator.clipboard.writeText(email);
    toast.success(`تم نسخ البريد الإلكتروني: ${email}`);
  };

  const [isSeeding, setIsSeeding] = useState(false);
  const handleSeedDefaults = async () => {
    const confirmed = await systemConfirm({
      title: 'استعادة وتحديث الدليل القياسي',
      message: 'هل ترغب في استعادة وتحديث الدليل القياسي لخطوط الملاحة وشركات الطيران والموانئ والمطارات الدولية؟ لن يتم حذف أي بيانات قمت بإضافتها مسبقاً.',
      confirmText: 'استعادة وتحديث',
      cancelText: 'إلغاء',
      variant: 'info',
    });
    if (!confirmed) return;
    try {
      setIsSeeding(true);
      await maritimeApi.seedDefaultMasterData();
      toast.success('تم استعادة وتحديث الدليل القياسي بنجاح', 'تحديث الدليل');
      onRefresh();
      refreshAll();
    } catch (err: any) {
      toast.error(err?.message || 'فشل استعادة الدليل القياسي', 'خطأ');
    } finally {
      setIsSeeding(false);
    }
  };

  const exportMasterDataCsv = () => {
    let filename = 'maritime_data.csv';
    let headers: string[] = [];
    let rows: (string | number)[][] = [];

    if (subTab === 'lines') {
      filename = `maritime_shipping_lines_${new Date().toISOString().split('T')[0]}.csv`;
      headers = ['كود الخط', 'اسم الخط بالعربية', 'اسم الخط بالإنجليزية', 'مسؤول الاتصال', 'الهاتف', 'البريد الإلكتروني', 'بريد الحجز', 'مسارات الشحن'];
      rows = filteredLines.map((l) => [
        `"${l.code || ''}"`,
        `"${l.name_ar || ''}"`,
        `"${l.name_en || ''}"`,
        `"${l.contact_person || ''}"`,
        `"${l.phone || ''}"`,
        `"${l.rfq_email || ''}"`,
        `"${l.booking_email || ''}"`,
        `"${l.trade_lanes || ''}"`
      ]);
    } else if (subTab === 'airlines') {
      filename = `air_freight_airlines_${new Date().toISOString().split('T')[0]}.csv`;
      headers = ['كود الناقل', 'بادئة بوليصة الشحن (AWB Prefix)', 'اسم شركة الطيران بالعربية', 'اسم شركة الطيران بالإنجليزية', 'مسؤول التواصل', 'الهاتف', 'بريد التسعير (RFQ)', 'بريد الحجز'];
      rows = filteredAirlines.map((a) => [
        `"${a.code || ''}"`,
        `"${a.airline_prefix || ''}"`,
        `"${a.name_ar || ''}"`,
        `"${a.name_en || ''}"`,
        `"${a.contact_person || ''}"`,
        `"${a.phone || ''}"`,
        `"${a.rfq_email || ''}"`,
        `"${a.booking_email || ''}"`
      ]);
    } else if (subTab === 'agents') {
      filename = `maritime_overseas_agents_${new Date().toISOString().split('T')[0]}.csv`;
      headers = ['كود الوكيل', 'اسم الوكيل بالعربية', 'اسم الوكيل بالإنجليزية', 'الدولة', 'المدينة', 'مسؤول التواصل', 'واتساب', 'البريد الإلكتروني (RFQ)', 'الخدمات المقدمة'];
      rows = filteredAgents.map((a) => [
        `"${a.code || ''}"`,
        `"${a.name_ar || ''}"`,
        `"${a.name_en || ''}"`,
        `"${a.country_name || ''}"`,
        `"${a.city_name || ''}"`,
        `"${a.contact_person || ''}"`,
        `"${a.whatsapp || ''}"`,
        `"${a.rfq_email || ''}"`,
        `"${a.services_offered || ''}"`
      ]);
    } else if (subTab === 'ports') {
      filename = `maritime_ports_${new Date().toISOString().split('T')[0]}.csv`;
      headers = ['كود الميناء (UN/LOCODE)', 'اسم الميناء بالعربية', 'اسم الميناء بالإنجليزية', 'كود الدولة', 'اسم الدولة'];
      rows = filteredPorts.map((p) => [
        `"${p.code || ''}"`,
        `"${p.name_ar || ''}"`,
        `"${p.name_en || ''}"`,
        `"${p.country_code || ''}"`,
        `"${p.country_name || ''}"`
      ]);
    } else if (subTab === 'airports') {
      filename = `air_freight_airports_${new Date().toISOString().split('T')[0]}.csv`;
      headers = ['كود المطار (IATA/ICAO)', 'اسم المطار بالعربية', 'اسم المطار بالإنجليزية', 'كود الدولة', 'اسم الدولة'];
      rows = filteredAirports.map((p) => [
        `"${p.code || p.iata_code || ''}"`,
        `"${p.name_ar || ''}"`,
        `"${p.name_en || ''}"`,
        `"${p.country_code || ''}"`,
        `"${p.country_name || ''}"`
      ]);
    } else {
      filename = `maritime_containers_specs_${new Date().toISOString().split('T')[0]}.csv`;
      headers = ['كود الحاوية', 'الاسم بالعربية', 'الاسم بالإنجليزية', 'الفئة', 'الطول بالقدم', 'أقصى وزن حمولة (كجم)', 'الحجم CBM'];
      rows = (filteredContainers || []).map((c) => [
        `"${c.code || ''}"`,
        `"${c.name_ar || ''}"`,
        `"${c.name_en || ''}"`,
        `"${c.category || ''}"`,
        c.length_feet || '',
        c.max_payload_kg || '',
        c.max_cbm || ''
      ]);
    }

    if (rows.length === 0) {
      toast.warning('لا توجد بيانات للتصدير في هذا التبويب.');
      return;
    }

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('تم تصدير البيانات بنجاح إلى ملف CSV.');
  };




  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', minWidth: 0, boxSizing: 'border-box' }} dir="rtl">
      {/* الكارت المؤسسي الموحد المتطابق مع باقي صفحات الموديول */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        <MasterDataHeader
          subTab={subTab}
          shippingLinesList={shippingLinesList}
          airlinesList={airlinesList}
          overseasAgentsList={overseasAgentsList}
          seaPortsList={seaPortsList}
          airPortsList={airPortsList}
          isSeeding={isSeeding}
          handleSeedDefaults={handleSeedDefaults}
          exportMasterDataCsv={exportMasterDataCsv}
          setImportModalOpen={setImportModalOpen}
          handleOpenAdd={handleOpenAdd}
          showAddPortForm={showAddPortForm}
          setShowAddPortForm={setShowAddPortForm}
          setEditingPartner={setEditingPartner}
          setModalType={setModalType}
          setModalOpen={setModalOpen}
        />

        <MasterDataTabsBar
          subTab={subTab}
          setSubTab={setSubTab}
          enableSeaFreight={enableSeaFreight}
          enableAirFreight={enableAirFreight}
          setSearchQuery={setSearchQuery}
          setSelectedLane={setSelectedLane}
          setSelectedCountry={setSelectedCountry}
          shippingLinesList={shippingLinesList}
          airlinesList={airlinesList}
          overseasAgentsList={overseasAgentsList}
          seaPortsList={seaPortsList}
          airPortsList={airPortsList}
        />

        {/* 3. شريط البحث والتصفية المتجاوب بدون تمدد خارجي */}
        {subTab === 'lines' && (
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e2e8f0',
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              minHeight: '58px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
              <input
                type="text"
                role="searchbox"
                name="search_maritime_lines"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={__t('maritime_freight.maritime_master_data_tab.s22', "بحث في الخطوط الملاحية والتوكيلات...")}
                style={{
                  width: '100%',
                  height: '34px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: searchQuery ? '0 32px 0 28px' : '0 32px 0 10px',
                  fontSize: '0.8125rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ position: 'absolute', right: '10px', top: '9px', color: '#94a3b8', pointerEvents: 'none' }}>
                <AppIcons.Search size={15} />
              </div>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title={__t('maritime_freight.maritime_master_data_tab.s23', "مسح البحث")}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px',
                    borderRadius: '50%',
                  }}
                >
                  <XIcon size={14} />
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s24', "المسار:")}</span>
              {[
                { id: 'all', label: __t('maritime_freight.maritime_master_data_tab.s25', "الكل") },
                { id: 'far_east', label: __t('maritime_freight.maritime_master_data_tab.s26', "الصين والشرق الأقصى") },
                { id: 'europe_med', label: __t('maritime_freight.maritime_master_data_tab.s27', "أوروبا والمتوسط") },
                { id: 'arabian_gulf', label: __t('maritime_freight.maritime_master_data_tab.s28', "الخليج والبحر الأحمر") },
                { id: 'americas', label: __t('maritime_freight.maritime_master_data_tab.s29', "الأمريكتين") },
              ].map((lane) => (
                <button
                  key={lane.id}
                  type="button"
                  onClick={() => setSelectedLane(lane.id)}
                  style={{
                    height: '28px',
                    padding: '0 10px',
                    borderRadius: '6px',
                    border: selectedLane === lane.id ? '1px solid #170e5e' : '1px solid #e2e8f0',
                    background: selectedLane === lane.id ? '#170e5e' : '#f8fafc',
                    color: selectedLane === lane.id ? '#ffffff' : '#475569',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {lane.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {subTab === 'airlines' && (
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e2e8f0',
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              minHeight: '58px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
              <input
                type="text"
                role="searchbox"
                name="search_maritime_airlines"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={__t('maritime_freight.maritime_master_data_tab.s30', "بحث في شركات الشحن الجوي والبادئات...")}
                style={{
                  width: '100%',
                  height: '34px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: searchQuery ? '0 32px 0 28px' : '0 32px 0 10px',
                  fontSize: '0.8125rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ position: 'absolute', right: '10px', top: '9px', color: '#94a3b8', pointerEvents: 'none' }}>
                <AppIcons.Search size={15} />
              </div>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title={__t('maritime_freight.maritime_master_data_tab.s31', "مسح البحث")}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px',
                    borderRadius: '50%',
                  }}
                >
                  <XIcon size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {subTab === 'agents' && (
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e2e8f0',
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              minHeight: '58px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
              <input
                type="text"
                role="searchbox"
                name="search_maritime_agents"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={__t('maritime_freight.maritime_master_data_tab.s32', "بحث باسم الوكيل، الدولة، أو الكود...")}
                style={{
                  width: '100%',
                  height: '34px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: searchQuery ? '0 32px 0 28px' : '0 32px 0 10px',
                  fontSize: '0.8125rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ position: 'absolute', right: '10px', top: '9px', color: '#94a3b8', pointerEvents: 'none' }}>
                <AppIcons.Search size={15} />
              </div>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title={__t('maritime_freight.maritime_master_data_tab.s33', "مسح البحث")}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px',
                    borderRadius: '50%',
                  }}
                >
                  <XIcon size={14} />
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s34', "دولة ومقر الوكيل:")}</span>
              <div style={{ minWidth: '200px' }}>
                <CustomSelect
                  value={selectedCountry}
                  onChange={(val) => setSelectedCountry(val || 'all')}
                  options={COUNTRY_OPTIONS.map((c) => ({ value: c.code, label: c.name }))}
                />
              </div>
            </div>
          </div>
        )}

        {(subTab === 'ports' || subTab === 'airports') && (
          <>
            {showAddPortForm && (
              <div
                style={{
                  padding: '16px 20px',
                  background: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                <h4 style={{ margin: '0 0 12px', fontSize: '0.88rem', fontWeight: 700, color: '#170e5e' }}>
                  {subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s35', "بيانات مطار الشحن الدولي الجديد (Cargo Airport)") : __t('maritime_freight.maritime_master_data_tab.s36', "بيانات الميناء الجديد (UN/LOCODE Seaport)")}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', alignItems: 'flex-end' }}>
                  <Field label={subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s37', "كود IATA (3 حروف) *") : __t('maritime_freight.maritime_master_data_tab.s38', "كود الميناء (UN/LOCODE) *")}>
                    <input
                      type="text"
                      value={newPortCode}
                      onChange={(e) => setNewPortCode(e.target.value.toUpperCase())}
                      placeholder={subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s39', "مثال: CAI, DXB") : __t('maritime_freight.maritime_master_data_tab.s40', "مثال: EGALY, CNSHA")}
                      style={{ width: '100%', height: '34px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '0.8125rem' }}
                    />
                  </Field>
                  <Field label={subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s41', "اسم المطار بالعربية *") : __t('maritime_freight.maritime_master_data_tab.s42', "اسم الميناء بالعربية *")}>
                    <input
                      type="text"
                      value={newPortNameAr}
                      onChange={(e) => setNewPortNameAr(e.target.value)}
                      placeholder={subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s43', "مطار القاهرة للشحن") : __t('maritime_freight.maritime_master_data_tab.s44', "ميناء الإسكندرية")}
                      style={{ width: '100%', height: '34px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '0.8125rem' }}
                    />
                  </Field>
                  <Field label={subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s45', "اسم المطار بالإنجليزية") : __t('maritime_freight.maritime_master_data_tab.s46', "اسم الميناء بالإنجليزية")}>
                    <input
                      type="text"
                      value={newPortNameEn}
                      onChange={(e) => setNewPortNameEn(e.target.value)}
                      placeholder={subTab === 'airports' ? 'Cairo Cargo Airport' : 'Alexandria Port'}
                      style={{ width: '100%', height: '34px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '0.8125rem' }}
                    />
                  </Field>
                  <Field label={__t('maritime_freight.maritime_master_data_tab.s47', "الدولة")}>
                    <input
                      type="text"
                      value={newPortCountryName}
                      onChange={(e) => setNewPortCountryName(e.target.value)}
                      placeholder={__t('maritime_freight.maritime_master_data_tab.s48', "مصر، الإمارات...")}
                      style={{ width: '100%', height: '34px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '0.8125rem' }}
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={handleAddPort}
                    disabled={isAddingPort}
                    style={{
                      height: '34px',
                      padding: '0 16px',
                      background: '#170e5e',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 700,
                      fontSize: '0.8125rem',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s49', "حفظ المطار") : __t('maritime_freight.maritime_master_data_tab.s50', "حفظ الميناء")}
                  </button>
                </div>
              </div>
            )}

            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#ffffff', minHeight: '58px', boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
                <input
                  type="text"
                  role="searchbox"
                  name="search_maritime_ports"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-form-type="other"
                  data-lpignore="true"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s51', "بحث في مطارات الشحن بالكود أو الاسم...") : __t('maritime_freight.maritime_master_data_tab.s52', "بحث في الموانئ بالكود أو الاسم...")}
                  style={{
                    width: '100%',
                    height: '34px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: searchQuery ? '0 32px 0 28px' : '0 32px 0 10px',
                    fontSize: '0.8125rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ position: 'absolute', right: '10px', top: '9px', color: '#94a3b8', pointerEvents: 'none' }}>
                  <AppIcons.Search size={15} />
                </div>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title={__t('maritime_freight.maritime_master_data_tab.s53', "مسح البحث")}
                    style={{
                      position: 'absolute',
                      left: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '2px',
                      borderRadius: '50%',
                    }}
                  >
                    <XIcon size={14} />
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* شريط البحث وتصنيفات المواصفات القياسية */}
        {subTab === 'standards' && (
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e2e8f0',
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              minHeight: '58px',
              boxSizing: 'border-box',
            }}
          >
            {/* أزرار التنقل بين الفئات القياسية */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  setStandardsSubCategory('containers');
                  setSearchQuery('');
                }}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: standardsSubCategory === 'containers' ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  background: standardsSubCategory === 'containers' ? '#170e5e' : '#f8fafc',
                  color: standardsSubCategory === 'containers' ? '#ffffff' : '#334155',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AppIcons.Container size={14} />
                <span>{__t('maritime_freight.maritime_master_data_tab.s54', "مواصفات الحاويات (ISO Containers)")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setStandardsSubCategory('incoterms');
                  setSearchQuery('');
                }}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: standardsSubCategory === 'incoterms' ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  background: standardsSubCategory === 'incoterms' ? '#170e5e' : '#f8fafc',
                  color: standardsSubCategory === 'incoterms' ? '#ffffff' : '#334155',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AppIcons.FileCheck size={14} />
                <span>{__t('maritime_freight.maritime_master_data_tab.s55', "شروط التجارة الدولية (Incoterms 2020)")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setStandardsSubCategory('terminals');
                  setSearchQuery('');
                }}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: standardsSubCategory === 'terminals' ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  background: standardsSubCategory === 'terminals' ? '#170e5e' : '#f8fafc',
                  color: standardsSubCategory === 'terminals' ? '#ffffff' : '#334155',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AppIcons.Building size={14} />
                <span>{__t('maritime_freight.maritime_master_data_tab.s56', "محطات الحاويات بالموانئ (Terminals)")}</span>
              </button>
            </div>

            {/* البحث وفلاتر الحاويات */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {standardsSubCategory === 'containers' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {[
                    { id: 'all', label: __t('maritime_freight.maritime_master_data_tab.s57', "الكل") },
                    { id: 'dry', label: __t('maritime_freight.maritime_master_data_tab.s58', "جافة (Dry)") },
                    { id: 'reefer', label: __t('maritime_freight.maritime_master_data_tab.s59', "مبردة (Reefer)") },
                    { id: 'special', label: __t('maritime_freight.maritime_master_data_tab.s60', "خاصة (Special)") },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setContainerCategoryFilter(cat.id as any)}
                      style={{
                        height: '28px',
                        padding: '0 10px',
                        borderRadius: '6px',
                        border: containerCategoryFilter === cat.id ? '1px solid #170e5e' : '1px solid #e2e8f0',
                        background: containerCategoryFilter === cat.id ? '#170e5e' : '#f8fafc',
                        color: containerCategoryFilter === cat.id ? '#ffffff' : '#475569',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ position: 'relative', width: '240px', maxWidth: '100%' }}>
                <input
                  type="text"
                  role="searchbox"
                  name="search_maritime_standards"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-form-type="other"
                  data-lpignore="true"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    standardsSubCategory === 'containers'
                      ? __t('maritime_freight.maritime_master_data_tab.s61', "بحث في الحاويات...")
                      : standardsSubCategory === 'incoterms'
                      ? __t('maritime_freight.maritime_master_data_tab.s62', "بحث في الـ Incoterms...")
                      : __t('maritime_freight.maritime_master_data_tab.s63', "بحث في محطات الموانئ...")
                  }
                  style={{
                    width: '100%',
                    height: '32px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: searchQuery ? '0 30px 0 26px' : '0 30px 0 8px',
                    fontSize: '0.78rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ position: 'absolute', right: '8px', top: '8px', color: '#94a3b8', pointerEvents: 'none' }}>
                  <AppIcons.Search size={14} />
                </div>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title={__t('maritime_freight.maritime_master_data_tab.s64', "مسح البحث")}
                    style={{
                      position: 'absolute',
                      left: '6px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '2px',
                      borderRadius: '50%',
                    }}
                  >
                    <XIcon size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 4. جداول البيانات المتطابقة بنسبة 100% مع معيار جداول رادار الحاويات والـ RFQ */}

        {/* أ. جدول الخطوط الملاحية */}
        {subTab === 'lines' && (
          <div style={{ width: '100%', overflowX: 'auto', minHeight: '480px' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.8125rem' }}>
              <colgroup>
                <col style={{ width: '10%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '23%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700, textAlign: 'center' }}>
                  <th style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s65', "كود الخط")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s66', "اسم الخط الملاحي")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s67', "مسارات الإبحار")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s68', "إيميل التسعير والحجز")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s69', "الهاتف والتواصل")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s70', "الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s71', "لا توجد خطوط ملاحية مطابقة لمعايير البحث")}
                    </td>
                  </tr>
                ) : (
                  filteredLines.map((line) => (
                    <tr key={line.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 800, color: '#170e5e', whiteSpace: 'nowrap' }}>
                        <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '3px 8px', borderRadius: '4px', fontSize: '0.78rem' }}>
                          {line.code}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={line.name_ar}>
                          {line.name_ar}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={line.name_en || ''}>
                          {line.name_en}
                        </div>
                        {line.trade_lanes && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                            {line.trade_lanes.split(',').slice(0, 2).map((lane: string) => {
                              const trimmed = lane.trim();
                              return (
                                <span
                                  key={trimmed}
                                  style={{
                                    fontSize: '0.66rem',
                                    fontWeight: 600,
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    background: '#f1f5f9',
                                    color: '#475569',
                                    border: '1px solid #e2e8f0',
                                  }}
                                >
                                  {TRADE_LANE_LABELS[trimmed] || trimmed}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {(line.notes || line.services_offered) && (
                          <div style={{ fontSize: '0.68rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }} title={line.notes || line.services_offered || undefined}>
                            {line.notes || line.services_offered}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {!line.trade_lanes ? (
                            <span style={{ color: '#94a3b8', fontSize: '0.74rem' }}>{__t('maritime_freight.maritime_master_data_tab.s72', "عالمي")}</span>
                          ) : (
                            line.trade_lanes.split(',').slice(0, 3).map((l) => (
                              <span
                                key={l}
                                style={{
                                  background: '#f1f5f9',
                                  color: '#334155',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {TRADE_LANE_LABELS[l.trim()] || l}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'left', direction: 'ltr' }}>
                        {line.rfq_email ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '6px', minWidth: 0, direction: 'ltr' }}>
                            <button
                              type="button"
                              onClick={() => handleCopyEmail(line.rfq_email!)}
                              title={__t('maritime_freight.maritime_master_data_tab.s73', "نسخ الإيميل")}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: '2px', flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}
                            >
                              <AppIcons.Copy size={13} />
                            </button>
                            <span
                              style={{
                                fontWeight: 600,
                                color: '#1d4ed8',
                                fontSize: '0.8rem',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                direction: 'ltr',
                                textAlign: 'left',
                              }}
                              title={line.rfq_email}
                            >
                              {line.rfq_email}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>{__t('maritime_freight.maritime_master_data_tab.s74', "غير مسجل")}</span>
                        )}
                        {line.booking_email && (
                          <div
                            style={{
                              fontSize: '0.72rem',
                              color: '#64748b',
                              direction: 'ltr',
                              textAlign: 'left',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              marginTop: '2px',
                            }}
                            title={`حجز: ${line.booking_email}`}
                          >
                            booking: {line.booking_email}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'left', direction: 'ltr' }}>
                        {line.phone ? (
                          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                            <a
                              href={`https://wa.me/${line.phone.replace(/[^\d]/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: '0.74rem',
                                color: '#15803d',
                                fontWeight: 700,
                                textDecoration: 'none',
                                direction: 'ltr',
                                textAlign: 'left',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                              title={__t('maritime_freight.maritime_master_data_tab.s75', "فتح محادثة واتساب")}
                            >
                              <span>{line.phone}</span>
                            </a>
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>-</div>
                        )}
                        {line.contact_person && (
                          <div style={{ fontSize: '0.72rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr', textAlign: 'left', marginTop: '2px' }}>
                            {line.contact_person}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(line)}
                          style={{
                            padding: '4px 10px',
                            background: '#f1f5f9',
                            color: '#170e5e',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            fontWeight: 600,
                            fontSize: '0.74rem',
                            cursor: 'pointer',
                          }}
                        >
                          {__t('maritime_freight.maritime_master_data_tab.s76', "تعديل")}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* أ2. جدول شركات الشحن الجوي */}
        {subTab === 'airlines' && (
          <div style={{ width: '100%', overflowX: 'auto', minHeight: '480px' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.8125rem' }}>
              <colgroup>
                <col style={{ width: '12%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700, textAlign: 'center' }}>
                  <th style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s77', "كود وبادئة AWB")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s78', "شركة الطيران / الشحن الجوي")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s79', "إيميل التسعير والحجز (RFQ)")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s80', "الهاتف والتواصل")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s81', "مسؤول الشحن")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s82', "الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredAirlines.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s83', "لا توجد شركات طيران مطابقة لمعايير البحث")}
                    </td>
                  </tr>
                ) : (
                  filteredAirlines.map((airline) => (
                    <tr key={airline.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 800, color: '#0284c7', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center' }}>
                          <span style={{ background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', padding: '2px 8px', borderRadius: '4px', fontSize: '0.78rem' }}>
                            {airline.code}
                          </span>
                          {airline.airline_prefix && (
                            <span style={{ fontSize: '0.7rem', color: '#0284c7', fontWeight: 700 }}>
                              AWB: {airline.airline_prefix}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={airline.name_ar}>
                          {airline.name_ar}
                        </div>
                        {airline.name_en && (
                          <div style={{ fontSize: '0.74rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr', textAlign: 'left', marginTop: '2px' }} title={airline.name_en}>
                            {airline.name_en}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'left', direction: 'ltr' }}>
                        {airline.rfq_email ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '6px', minWidth: 0 }}>
                            <button
                              type="button"
                              onClick={() => handleCopyEmail(airline.rfq_email!)}
                              title={__t('maritime_freight.maritime_master_data_tab.s84', "نسخ إيميل التسعير")}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#64748b',
                                padding: '2px',
                                flexShrink: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                              }}
                            >
                              <AppIcons.Copy size={13} />
                            </button>
                            <span
                              style={{
                                fontWeight: 600,
                                color: '#0369a1',
                                fontSize: '0.8rem',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              title={airline.rfq_email}
                            >
                              {airline.rfq_email}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>-</span>
                        )}
                        {airline.booking_email && airline.booking_email !== airline.rfq_email && (
                          <div
                            style={{
                              fontSize: '0.72rem',
                              color: '#64748b',
                              marginTop: '3px',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={airline.booking_email}
                          >
                            booking: {airline.booking_email}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'left', direction: 'ltr' }}>
                        {airline.phone ? (
                          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                            <a
                              href={`https://wa.me/${airline.phone.replace(/[^\d]/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: '0.74rem',
                                color: '#15803d',
                                fontWeight: 700,
                                textDecoration: 'none',
                                direction: 'ltr',
                                textAlign: 'left',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                              title={__t('maritime_freight.maritime_master_data_tab.s85', "فتح محادثة واتساب")}
                            >
                              <span>{airline.phone}</span>
                            </a>
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>-</div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'center' }}>
                        <span style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 600 }}>
                          {airline.contact_person || '-'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '4px', justifyContent: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(airline)}
                            style={{
                              padding: '4px 10px',
                              background: '#f1f5f9',
                              color: '#170e5e',
                              border: '1px solid #e2e8f0',
                              borderRadius: '6px',
                              fontWeight: 600,
                              fontSize: '0.74rem',
                              cursor: 'pointer',
                            }}
                          >
                            {__t('maritime_freight.maritime_master_data_tab.s86', "تعديل")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePartner(airline)}
                            style={{
                              padding: '4px 8px',
                              background: '#fff1f2',
                              color: '#be123c',
                              border: '1px solid #fecdd3',
                              borderRadius: '6px',
                              fontWeight: 600,
                              fontSize: '0.74rem',
                              cursor: 'pointer',
                            }}
                          >
                            {__t('maritime_freight.maritime_master_data_tab.s87', "حذف")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ب. جدول وكلاء الشحن الدوليين بالخارج */}
        {subTab === 'agents' && (
          <div style={{ width: '100%', overflowX: 'auto', minHeight: '480px' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.8125rem' }}>
              <colgroup>
                <col style={{ width: '11%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700, textAlign: 'center' }}>
                  <th style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s88', "كود الوكيل")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s89', "اسم الشركة الوكيلة")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s90', "الدولة والمدينة")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s91', "مسؤول التسعير والتواصل")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s92', "البريد الإلكتروني (RFQ)")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s93', "الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s94', "لا يوجد وكلاء شحن مسجلون في هذه الدولة حالياً")}
                    </td>
                  </tr>
                ) : (
                  filteredAgents.map((agent) => (
                    <tr key={agent.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 800, color: '#170e5e', whiteSpace: 'nowrap' }}>
                        <span style={{ background: '#f0fdf4', color: '#166534', padding: '3px 8px', borderRadius: '4px', fontSize: '0.78rem' }}>
                          {agent.code}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'right' }} title={agent.name_ar}>
                          {agent.name_ar}
                        </div>
                        {agent.name_en && (
                          <div style={{ fontSize: '0.74rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr', textAlign: 'left', marginTop: '2px' }} title={agent.name_en}>
                            {agent.name_en}
                          </div>
                        )}
                        {agent.services_offered && (
                          <div style={{ fontSize: '0.68rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr', textAlign: 'left', marginTop: '2px' }} title={agent.services_offered}>
                            {agent.services_offered}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden' }}>
                        <div style={{ fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'right' }}>
                          {agent.country_name || __t('maritime_freight.maritime_master_data_tab.s95', "غير محدد")}
                        </div>
                        {agent.city_name && (
                          <div style={{ fontSize: '0.74rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'right', marginTop: '2px' }}>
                            {__t('maritime_freight.maritime_master_data_tab.s96', "مدينة:")} {agent.city_name}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'left', direction: 'ltr' }}>
                        <div
                          style={{
                            color: '#0369a1',
                            fontWeight: 600,
                            fontSize: '0.78rem',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            direction: 'ltr',
                            textAlign: 'left',
                          }}
                          title={agent.contact_person || ''}
                        >
                          {agent.contact_person || '-'}
                        </div>
                        {agent.whatsapp && (
                          <div style={{ marginTop: '3px', display: 'flex', justifyContent: 'flex-start' }}>
                            <a
                              href={`https://wa.me/${agent.whatsapp.replace(/[^\d]/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: '0.72rem',
                                color: '#15803d',
                                fontWeight: 700,
                                textDecoration: 'none',
                                background: '#f0fdf4',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                border: '1px solid #bbf7d0',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                direction: 'ltr',
                                textAlign: 'left',
                              }}
                              title={__t('maritime_freight.maritime_master_data_tab.s97', "فتح محادثة واتساب فورية")}
                            >
                              WA: {agent.whatsapp}
                            </a>
                          </div>
                        )}
                        {agent.wechat && !agent.whatsapp && (
                          <div
                            style={{
                              fontSize: '0.72rem',
                              color: '#0284c7',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              direction: 'ltr',
                              textAlign: 'left',
                              marginTop: '2px',
                            }}
                          >
                            WeChat: {agent.wechat}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'left', direction: 'ltr' }}>
                        {agent.rfq_email ? (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-start',
                              gap: '6px',
                              minWidth: 0,
                              direction: 'ltr',
                              textAlign: 'left',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => handleCopyEmail(agent.rfq_email!)}
                              title={__t('maritime_freight.maritime_master_data_tab.s98', "نسخ الإيميل")}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#64748b',
                                padding: '2px',
                                flexShrink: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                              }}
                            >
                              <AppIcons.Copy size={13} />
                            </button>
                            <span
                              style={{
                                fontWeight: 600,
                                color: '#1d4ed8',
                                fontSize: '0.8rem',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                direction: 'ltr',
                                textAlign: 'left',
                              }}
                              title={agent.rfq_email}
                            >
                              {agent.rfq_email}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '4px', justifyContent: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(agent)}
                            style={{
                              padding: '4px 8px',
                              background: '#f1f5f9',
                              color: '#170e5e',
                              border: '1px solid #e2e8f0',
                              borderRadius: '6px',
                              fontWeight: 600,
                              fontSize: '0.74rem',
                              cursor: 'pointer',
                            }}
                          >
                            {__t('maritime_freight.maritime_master_data_tab.s99', "تعديل")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePartner(agent)}
                            style={{
                              padding: '4px 8px',
                              background: '#fff1f2',
                              color: '#be123c',
                              border: '1px solid #fecdd3',
                              borderRadius: '6px',
                              fontWeight: 600,
                              fontSize: '0.74rem',
                              cursor: 'pointer',
                            }}
                          >
                            {__t('maritime_freight.maritime_master_data_tab.s100', "حذف")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ج. جدول الموانئ البحرية */}
        {subTab === 'ports' && (
          <div style={{ width: '100%', overflowX: 'auto', minHeight: '480px' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.8125rem' }}>
              <colgroup>
                <col style={{ width: '15%' }} />
                <col style={{ width: '35%' }} />
                <col style={{ width: '30%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700 }}>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s101', "كود UN/LOCODE")}</th>
                  <th style={{ padding: '12px 14px' }}>{__t('maritime_freight.maritime_master_data_tab.s102', "الاسم بالعربية")}</th>
                  <th style={{ padding: '12px 14px' }}>{__t('maritime_freight.maritime_master_data_tab.s103', "الاسم بالإنجليزية")}</th>
                  <th style={{ padding: '12px 14px' }}>{__t('maritime_freight.maritime_master_data_tab.s104', "الدولة والرمز")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredPorts.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s105', "لا توجد موانئ مطابقة لبحثك")}
                    </td>
                  </tr>
                ) : (
                  filteredPorts.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 800, color: '#170e5e', whiteSpace: 'nowrap' }}>
                        <span style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '3px 8px', borderRadius: '4px' }}>
                          {p.code}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name_ar}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name_en}
                      </td>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{p.country_name}</span>
                        <span style={{ color: '#64748b', fontSize: '0.74rem', marginInlineStart: '6px' }}>({p.country_code})</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ج2. جدول مطارات الشحن الدولية */}
        {subTab === 'airports' && (
          <div style={{ width: '100%', overflowX: 'auto', minHeight: '480px' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.8125rem' }}>
              <colgroup>
                <col style={{ width: '15%' }} />
                <col style={{ width: '35%' }} />
                <col style={{ width: '30%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700 }}>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s106', "كود IATA / ICAO")}</th>
                  <th style={{ padding: '12px 14px' }}>{__t('maritime_freight.maritime_master_data_tab.s107', "اسم المطار بالعربية")}</th>
                  <th style={{ padding: '12px 14px' }}>{__t('maritime_freight.maritime_master_data_tab.s108', "الاسم بالإنجليزية")}</th>
                  <th style={{ padding: '12px 14px' }}>{__t('maritime_freight.maritime_master_data_tab.s109', "الدولة والرمز")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredAirports.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s110', "لا توجد مطارات شحن مطابقة لبحثك")}
                    </td>
                  </tr>
                ) : (
                  filteredAirports.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 800, color: '#0284c7', whiteSpace: 'nowrap' }}>
                        <span style={{ background: '#f0f9ff', border: '1px solid #bae6fd', padding: '3px 8px', borderRadius: '4px' }}>
                          {p.iata_code || p.code}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name_ar}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name_en}
                      </td>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{p.country_name}</span>
                        <span style={{ color: '#64748b', fontSize: '0.74rem', marginInlineStart: '6px' }}>({p.country_code})</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* د. قسم المواصفات القياسية و Incoterms 2020 */}
        {subTab === 'standards' && (
          <div style={{ padding: '16px', minHeight: '480px', boxSizing: 'border-box' }}>
            {isLoadingRefData ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontSize: '0.84rem' }}>
                {__t('maritime_freight.maritime_master_data_tab.s111', "جاري تحميل المراجع القياسية ومواصفات الحاويات...")}
              </div>
            ) : standardsSubCategory === 'containers' ? (
              <div>
                <div style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s112', "المواصفات الهندسية للحاويات القياسية (ISO 6346 Container Specifications)")}
                    </h4>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s113', "الأوزان القصوى، السعات الحجمية بالمتر المكعب (CBM)، والأبعاد الداخلية والخارجية المعتمدة دولياً")}
                    </p>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#170e5e', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '3px 10px', borderRadius: '12px' }}>
                    {filteredContainers.length} {__t('maritime_freight.maritime_master_data_tab.s114', "نوع حاوية")}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                    gap: '14px',
                  }}
                >
                  {filteredContainers.map((c) => (
                    <div
                      key={c.code}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                      }}
                    >
                      {/* هيدر كارت الحاوية */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                fontWeight: 800,
                                fontSize: '0.88rem',
                                color: '#170e5e',
                                background: '#f1f5f9',
                                border: '1px solid #cbd5e1',
                                padding: '2px 8px',
                                borderRadius: '4px',
                              }}
                            >
                              {c.code}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#0f172a' }}>
                              {c.name_ar}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                            {c.name_en} ({c.length_feet} ft)
                          </div>
                        </div>

                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '10px',
                            background:
                              c.category === 'dry'
                                ? '#f1f5f9'
                                : c.category === 'reefer'
                                ? '#eff6ff'
                                : '#fef3c7',
                            color:
                              c.category === 'dry'
                                ? '#334155'
                                : c.category === 'reefer'
                                ? '#1d4ed8'
                                : '#b45309',
                            border: `1px solid ${
                              c.category === 'dry'
                                ? '#cbd5e1'
                                : c.category === 'reefer'
                                ? '#bfdbfe'
                                : '#fde68a'
                            }`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.category === 'dry'
                            ? __t('maritime_freight.maritime_master_data_tab.s115', "بضائع عامة جافة")
                            : c.category === 'reefer'
                            ? __t('maritime_freight.maritime_master_data_tab.s116', "مبردة ومجمدة")
                            : __t('maritime_freight.maritime_master_data_tab.s117', "تجهيز وتداول خاص")}
                        </span>
                      </div>

                      {/* مؤشرات السعة والأوزان */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr',
                          gap: '6px',
                          background: '#f8fafc',
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid #f1f5f9',
                          textAlign: 'center',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '0.6875rem', color: '#64748b' }}>{__t('maritime_freight.maritime_master_data_tab.s118', "السعة (CBM)")}</div>
                          <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0369a1', marginTop: '2px' }}>
                            {c.max_cbm} {__t('maritime_freight.maritime_master_data_tab.s119', "م³")}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.6875rem', color: '#64748b' }}>{__t('maritime_freight.maritime_master_data_tab.s120', "أقصى حمولة")}</div>
                          <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#15803d', marginTop: '2px' }}>
                            {c.max_payload_kg.toLocaleString()} {__t('maritime_freight.maritime_master_data_tab.s121', "كجم")}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.6875rem', color: '#64748b' }}>{__t('maritime_freight.maritime_master_data_tab.s122', "الوزن فارغ")}</div>
                          <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#475569', marginTop: '2px' }}>
                            {c.tare_weight_kg.toLocaleString()} {__t('maritime_freight.maritime_master_data_tab.s123', "كجم")}
                          </div>
                        </div>
                      </div>

                      {/* الأبعاد الهندسية */}
                      <div
                        style={{
                          fontSize: '0.74rem',
                          color: '#334155',
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748b' }}>{__t('maritime_freight.maritime_master_data_tab.s124', "الأبعاد الداخلية (ط × ع × ع):")}</span>
                          <span style={{ fontWeight: 600, direction: 'ltr' }}>
                            {c.internal_length_m} × {c.internal_width_m} × {c.internal_height_m} m
                          </span>
                        </div>
                        {c.door_width_m > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#64748b' }}>{__t('maritime_freight.maritime_master_data_tab.s125', "أبعاد فتحة الباب (ع × ع):")}</span>
                            <span style={{ fontWeight: 600, direction: 'ltr' }}>
                              {c.door_width_m} × {c.door_height_m} m
                            </span>
                          </div>
                        )}
                      </div>

                      {/* الوصف الفني للضبط المتوازي */}
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.75rem',
                          color: '#64748b',
                          textAlign: 'justify',
                          textJustify: 'inter-word',
                          textAlignLast: 'start',
                          lineHeight: 1.5,
                        }}
                      >
                        {c.description_ar}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : standardsSubCategory === 'incoterms' ? (
              <div>
                <div style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s126', "قواعد التجارة الدولية (Incoterms 2020 Rules)")}
                    </h4>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s127', "توزيع التكاليف ومسؤوليات الشحن والتأمين ونقاط انتقال المخاطر القانونية بين البائع والمشتري")}
                    </p>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#170e5e', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '3px 10px', borderRadius: '12px' }}>
                    {filteredIncoterms.length} {__t('maritime_freight.maritime_master_data_tab.s128', "قاعدة تجارية")}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                    gap: '14px',
                  }}
                >
                  {filteredIncoterms.map((inc) => (
                    <div
                      key={inc.code}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                      }}
                    >
                      {/* هيدر القاعدة */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                fontWeight: 800,
                                fontSize: '0.88rem',
                                color: '#170e5e',
                                background: '#eff6ff',
                                border: '1px solid #bfdbfe',
                                padding: '2px 8px',
                                borderRadius: '4px',
                              }}
                            >
                              {inc.code}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#0f172a' }}>
                              {inc.name_ar}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                            {inc.name_en}
                          </div>
                        </div>

                        <span
                          style={{
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '10px',
                            background: inc.rule_type === 'sea_inland_waterway' ? '#f0fdf4' : '#f8fafc',
                            color: inc.rule_type === 'sea_inland_waterway' ? '#166534' : '#475569',
                            border: `1px solid ${inc.rule_type === 'sea_inland_waterway' ? '#bbf7d0' : '#e2e8f0'}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {inc.rule_type === 'sea_inland_waterway' ? __t('maritime_freight.maritime_master_data_tab.s129', "بحري ونهري فقط") : __t('maritime_freight.maritime_master_data_tab.s130', "متعدد الوسائط")}
                        </span>
                      </div>

                      {/* نقطة انتقال المخاطر */}
                      <div
                        style={{
                          background: '#f8fafc',
                          borderInlineStart: '3px solid #170e5e',
                          padding: '6px 10px',
                          borderRadius: '0 4px 4px 0',
                          fontSize: '0.74rem',
                          color: '#1e293b',
                        }}
                      >
                        <strong style={{ color: '#170e5e' }}>{__t('maritime_freight.maritime_master_data_tab.s131', "نقطة انتقال المسؤولية:")} </strong>
                        <span>{inc.risk_transfer_point_ar}</span>
                      </div>

                      {/* جدول المسؤوليات والتكاليف */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '6px',
                          fontSize: '0.72rem',
                        }}
                      >
                        <div
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: inc.seller_pays_export_customs ? '#f0fdf4' : '#f8fafc',
                            border: `1px solid ${inc.seller_pays_export_customs ? '#bbf7d0' : '#e2e8f0'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#475569' }}>{__t('maritime_freight.maritime_master_data_tab.s132', "جمارك التصدير:")}</span>
                          <strong style={{ color: inc.seller_pays_export_customs ? '#166534' : '#64748b' }}>
                            {inc.seller_pays_export_customs ? __t('maritime_freight.maritime_master_data_tab.s133', "البائع") : __t('maritime_freight.maritime_master_data_tab.s134', "المشتري")}
                          </strong>
                        </div>

                        <div
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: inc.seller_pays_origin_thc ? '#f0fdf4' : '#f8fafc',
                            border: `1px solid ${inc.seller_pays_origin_thc ? '#bbf7d0' : '#e2e8f0'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#475569' }}>{__t('maritime_freight.maritime_master_data_tab.s135', "شحن المغادرة THC:")}</span>
                          <strong style={{ color: inc.seller_pays_origin_thc ? '#166534' : '#64748b' }}>
                            {inc.seller_pays_origin_thc ? __t('maritime_freight.maritime_master_data_tab.s136', "البائع") : __t('maritime_freight.maritime_master_data_tab.s137', "المشتري")}
                          </strong>
                        </div>

                        <div
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: inc.seller_pays_ocean_freight ? '#f0fdf4' : '#f8fafc',
                            border: `1px solid ${inc.seller_pays_ocean_freight ? '#bbf7d0' : '#e2e8f0'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#475569' }}>{__t('maritime_freight.maritime_master_data_tab.s138', "نولون الشحن البحري:")}</span>
                          <strong style={{ color: inc.seller_pays_ocean_freight ? '#166534' : '#64748b' }}>
                            {inc.seller_pays_ocean_freight ? __t('maritime_freight.maritime_master_data_tab.s139', "البائع") : __t('maritime_freight.maritime_master_data_tab.s140', "المشتري")}
                          </strong>
                        </div>

                        <div
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: inc.seller_pays_destination_thc ? '#f0fdf4' : '#f8fafc',
                            border: `1px solid ${inc.seller_pays_destination_thc ? '#bbf7d0' : '#e2e8f0'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#475569' }}>{__t('maritime_freight.maritime_master_data_tab.s141', "شحن الوصول THC:")}</span>
                          <strong style={{ color: inc.seller_pays_destination_thc ? '#166534' : '#64748b' }}>
                            {inc.seller_pays_destination_thc ? __t('maritime_freight.maritime_master_data_tab.s142', "البائع") : __t('maritime_freight.maritime_master_data_tab.s143', "المشتري")}
                          </strong>
                        </div>

                        <div
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: inc.seller_pays_insurance ? '#eff6ff' : '#f8fafc',
                            border: `1px solid ${inc.seller_pays_insurance ? '#bfdbfe' : '#e2e8f0'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#475569' }}>{__t('maritime_freight.maritime_master_data_tab.s144', "التأمين البحري:")}</span>
                          <strong style={{ color: inc.seller_pays_insurance ? '#1d4ed8' : '#64748b' }}>
                            {inc.seller_pays_insurance ? __t('maritime_freight.maritime_master_data_tab.s145', "البائع") : __t('maritime_freight.maritime_master_data_tab.s146', "المشتري")}
                          </strong>
                        </div>

                        <div
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: inc.seller_pays_import_customs ? '#f0fdf4' : '#f8fafc',
                            border: `1px solid ${inc.seller_pays_import_customs ? '#bbf7d0' : '#e2e8f0'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#475569' }}>{__t('maritime_freight.maritime_master_data_tab.s147', "جمارك الاستيراد:")}</span>
                          <strong style={{ color: inc.seller_pays_import_customs ? '#166534' : '#64748b' }}>
                            {inc.seller_pays_import_customs ? __t('maritime_freight.maritime_master_data_tab.s148', "البائع") : __t('maritime_freight.maritime_master_data_tab.s149', "المشتري")}
                          </strong>
                        </div>
                      </div>

                      {/* الوصف */}
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.74rem',
                          color: '#64748b',
                          textAlign: 'justify',
                          textJustify: 'inter-word',
                          textAlignLast: 'start',
                          lineHeight: 1.5,
                        }}
                      >
                        {inc.description_ar}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s150', "محطات الحاويات واللوجستيات بالموانئ (Port Terminals)")}
                    </h4>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s151', "دليل محطات تداول الحاويات والبضائع بالموانئ المصرية والدولية والربط مع منظومة نافذة")}
                    </p>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#170e5e', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '3px 10px', borderRadius: '12px' }}>
                    {filteredTerminals.length} {__t('maritime_freight.maritime_master_data_tab.s152', "محطة")}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                    gap: '14px',
                  }}
                >
                  {filteredTerminals.map((t) => (
                    <div
                      key={t.code}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <span
                            style={{
                              fontWeight: 800,
                              fontSize: '0.84rem',
                              color: '#170e5e',
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              padding: '2px 8px',
                              borderRadius: '4px',
                            }}
                          >
                            {t.code}
                          </span>
                          <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#0f172a', marginTop: '6px' }}>
                            {t.name_ar}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t.name_en}</div>
                        </div>

                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '10px',
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            border: '1px solid #bfdbfe',
                          }}
                        >
                          {t.port_code}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.75rem', color: '#334155' }}>
                        <span style={{ color: '#64748b' }}>{__t('maritime_freight.maritime_master_data_tab.s153', "المشغل:")} </span>
                        <strong>{t.terminal_operator}</strong>
                      </div>

                      {t.notes && (
                        <p
                          style={{
                            margin: 0,
                            fontSize: '0.74rem',
                            color: '#64748b',
                            background: '#f8fafc',
                            padding: '6px 10px',
                            borderRadius: '4px',
                            border: '1px solid #f1f5f9',
                            lineHeight: 1.45,
                          }}
                        >
                          {t.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* النافذة المنبثقة الموحدة لإضافة وتعديل الشركاء */}
      <PartnerFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={onRefresh}
        partner={editingPartner}
        defaultType={modalType}
      />

      {/* النافذة المنبثقة لاستيراد البيانات من Excel / CSV */}
      <ImportCarriersModal
        open={importModalOpen}
        defaultType={subTab === 'lines' ? 'shipping_line' : 'overseas_agent'}
        onClose={() => setImportModalOpen(false)}
        onSuccess={() => {
          setImportModalOpen(false);
          onRefresh();
        }}
      />
    </div>
  );
}
