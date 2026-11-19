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
import { MasterDataLinesTable } from './master-data/MasterDataLinesTable';
import { AppIcons, XIcon } from '@/shared/components/icons/AppIcons';
import { PartnerFormModal } from './PartnerFormModal';
import { ImportCarriersModal } from './ImportCarriersModal';
import { MasterDataContainersSection } from './master-data/MasterDataContainersSection';
import { MasterDataPortsTables } from './master-data/MasterDataPortsTables';
import { MasterDataAgentsTable } from './master-data/MasterDataAgentsTable';
import { MasterDataAirlinesTable } from './master-data/MasterDataAirlinesTable';
import { MasterDataTabsBar } from './master-data/MasterDataTabsBar';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { CustomSelect } from '@/shared/ui/custom-select';
import { MasterDataFilterBars } from './master-data/MasterDataFilterBars';
import { useMaritime } from '../context/MaritimeContext';
import { MasterDataStandardsBar } from './master-data/MasterDataStandardsBar';
import { MasterDataHeader } from './master-data/MasterDataHeader';

interface MaritimeMasterDataTabProps {
  ports: ShippingPort[];
  lines: ShippingLine[];
  onRefresh: () => void;
}


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

        <MasterDataFilterBars
          subTab={subTab}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedLane={selectedLane}
          setSelectedLane={setSelectedLane}
          selectedCountry={selectedCountry}
          setSelectedCountry={setSelectedCountry}
          showAddPortForm={showAddPortForm}
          newPortCode={newPortCode}
          setNewPortCode={setNewPortCode}
          newPortNameAr={newPortNameAr}
          setNewPortNameAr={setNewPortNameAr}
          newPortNameEn={newPortNameEn}
          setNewPortNameEn={setNewPortNameEn}
          newPortCountryName={newPortCountryName}
          setNewPortCountryName={setNewPortCountryName}
          isAddingPort={isAddingPort}
          handleAddPort={handleAddPort}
        />

        <MasterDataStandardsBar
          subTab={subTab}
          standardsSubCategory={standardsSubCategory}
          setStandardsSubCategory={setStandardsSubCategory}
          containerCategoryFilter={containerCategoryFilter}
          setContainerCategoryFilter={setContainerCategoryFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />

        {/* 4. جداول البيانات المتطابقة بنسبة 100% مع معيار جداول رادار الحاويات والـ RFQ */}

        <MasterDataLinesTable subTab={subTab} filteredLines={filteredLines} handleOpenEdit={handleOpenEdit} handleCopyEmail={handleCopyEmail} />

        <MasterDataAirlinesTable
          subTab={subTab}
          filteredAirlines={filteredAirlines}
          handleOpenEdit={handleOpenEdit}
          handleDeletePartner={handleDeletePartner}
          handleCopyEmail={handleCopyEmail}
        />

        <MasterDataAgentsTable
          subTab={subTab}
          filteredAgents={filteredAgents}
          handleOpenEdit={handleOpenEdit}
          handleDeletePartner={handleDeletePartner}
          handleCopyEmail={handleCopyEmail}
        />

        <MasterDataPortsTables
          subTab={subTab}
          filteredPorts={filteredPorts}
          filteredAirports={filteredAirports}
        />

        {/* د. قسم المواصفات القياسية و Incoterms 2020 */}
        {subTab === 'standards' && (
          <div style={{ padding: '16px', minHeight: '480px', boxSizing: 'border-box' }}>
            {isLoadingRefData ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontSize: '0.84rem' }}>
                {__t('maritime_freight.maritime_master_data_tab.s111', "جاري تحميل المراجع القياسية ومواصفات الحاويات...")}
              </div>
            ) : standardsSubCategory === 'containers' ? (
              <MasterDataContainersSection filteredContainers={filteredContainers} />
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
