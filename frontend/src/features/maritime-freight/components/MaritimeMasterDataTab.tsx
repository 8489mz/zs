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
import { MasterDataTerminalsSection } from './master-data/MasterDataTerminalsSection';
import { MasterDataIncotermsSection } from './master-data/MasterDataIncotermsSection';
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
              <MasterDataIncotermsSection filteredIncoterms={filteredIncoterms} />
            ) : (
              <MasterDataTerminalsSection filteredTerminals={filteredTerminals} />
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
