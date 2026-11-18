import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { posApi, type PosCustomerDeliveryProfile, type PosCustomerDeliveryProfileOrder } from '@/features/pos/api/pos.api';
import { catalogApi } from '@/lib/api/catalog';
import { deliveryRepsApi, type DeliveryRep } from '@/shared/api/delivery-reps.api';
import { toast } from '@/shared/components/system-alert';
import { formatCurrency, formatDate } from '@/lib/format';
import { callerIdService, type CallerIdCallEvent } from '@/features/pos/lib/pos-caller-id-service';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { PosItem } from '@/features/pos/types/pos.types';
import {
  PhoneIcon,
  PhoneCallIcon,
  PhoneIncomingIcon,
  SearchIcon,
  PlusIcon,
  CheckCircleIcon,
  ClockIcon,
  MapPinIcon,
  ReceiptIcon,
  RotateCcwIcon,
  RefreshCwIcon,
  XIcon,
  CreditCardIcon,
  DollarSignIcon,
  TrashIcon,
  UserIcon,
  ArrowLeftIcon,
} from '@/shared/components/icons/AppIcons';
import { getCurrencySymbol, isKuwait, isSaudi } from '@/lib/currencies';
import { PosPhoneOrderDialogTabs } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderDialogTabs';
import { PosPhoneOrderDialogFooter } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderDialogFooter';
import { PosPhoneOrderRecentCalls } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderRecentCalls';
import { PosPhoneOrderDialogHardware } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderDialogHardware';

interface PosPhoneOrderDialogProps {
  open: boolean;
  onClose: () => void;
  pos: PosWorkspaceState;
  initialPhone?: string;
  initialName?: string;
}

export type DoorstepPaymentMethod = 'cash' | 'card_pos' | 'instapay_wallet';

const EGP_DELIVERY_ZONES = [
  { id: 'zone_standard', name: 'توصيل عادي / داخل النطاق', fee: 15, eta: 30 },
  { id: 'zone_near', name: 'منطقة قريبة (أقل من 3 كم)', fee: 10, eta: 25 },
  { id: 'zone_med', name: 'منطقة متوسطة (3 - 6 كم)', fee: 20, eta: 35 },
  { id: 'zone_far', name: 'منطقة بعيدة (6 - 10 كم)', fee: 30, eta: 45 },
  { id: 'zone_extra', name: 'توصيل ممتد / خارج النطاق', fee: 45, eta: 60 },
  { id: 'zone_custom', name: 'تحديد رسوم مخصصة يدويًا', fee: 0, eta: 35 },
];

const KWD_DELIVERY_ZONES = [
  { id: 'zone_standard', name: 'توصيل عادي / داخل المنطقة', fee: 1.000, eta: 30 },
  { id: 'zone_near', name: 'منطقة قريبة / مجاورة', fee: 0.500, eta: 20 },
  { id: 'zone_med', name: 'منطقة متوسطة (محافظة تابعة)', fee: 1.500, eta: 35 },
  { id: 'zone_far', name: 'منطقة بعيدة (محافظة أخرى)', fee: 2.000, eta: 45 },
  { id: 'zone_extra', name: 'توصيل ممتد / أطراف الكويت', fee: 2.500, eta: 60 },
  { id: 'zone_custom', name: 'تحديد رسوم مخصصة يدويًا', fee: 0, eta: 35 },
];

const SAR_DELIVERY_ZONES = [
  { id: 'zone_standard', name: 'توصيل عادي / داخل الحي', fee: 12, eta: 30 },
  { id: 'zone_near', name: 'حي مجاور (أقل من 5 كم)', fee: 8, eta: 25 },
  { id: 'zone_med', name: 'نطاق متوسط (5 - 12 كم)', fee: 18, eta: 40 },
  { id: 'zone_far', name: 'نطاق بعيد / أطراف المدينة', fee: 28, eta: 50 },
  { id: 'zone_extra', name: 'ضواحي ومناطق ممتدة', fee: 40, eta: 65 },
  { id: 'zone_custom', name: 'تحديد رسوم مخصصة يدويًا', fee: 0, eta: 35 },
];

export function PosPhoneOrderDialog({
  open,
  onClose,
  pos,
  initialPhone = '',
  initialName = '',
}: PosPhoneOrderDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [phoneQuery, setPhoneQuery] = useState(initialPhone);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<string>('');
  const [isCustomAddressMode, setIsCustomAddressMode] = useState(false);
  const [customAddressInput, setCustomAddressInput] = useState('');
  const [addressTag, setAddressTag] = useState<'home' | 'work' | 'other'>('home');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [isForceNewCustomer, setIsForceNewCustomer] = useState(false);

  const isKwd = isKuwait(pos.settingsQuery?.data);
  const isKsa = isSaudi(pos.settingsQuery?.data);
  const deliveryZones = isKwd ? KWD_DELIVERY_ZONES : isKsa ? SAR_DELIVERY_ZONES : EGP_DELIVERY_ZONES;
  const currencySym = getCurrencySymbol();

  // Delivery & Payment Enhancements
  const [selectedZoneId, setSelectedZoneId] = useState<string>('zone_standard');
  const [customDeliveryFee, setCustomDeliveryFee] = useState<number>(isKwd ? 1.000 : isKsa ? 12 : 15);
  const [etaMinutes, setEtaMinutes] = useState<number>(30);
  const [paymentMethodAtDoor, setPaymentMethodAtDoor] = useState<DoorstepPaymentMethod>('cash');
  const [customerPaidNote, setCustomerPaidNote] = useState<string>('');
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');

  // Kuwait PACI Address Helper State
  const [paciArea, setPaciArea] = useState('');
  const [paciBlock, setPaciBlock] = useState('');
  const [paciStreet, setPaciStreet] = useState('');
  const [paciAvenue, setPaciAvenue] = useState('');
  const [paciHouse, setPaciHouse] = useState('');
  const [paciFloor, setPaciFloor] = useState('');
  const [paciApt, setPaciApt] = useState('');
  const [paciAutoNumber, setPaciAutoNumber] = useState('');

  function buildPaciAddress(overrides?: {
    area?: string;
    block?: string;
    street?: string;
    avenue?: string;
    house?: string;
    floor?: string;
    apt?: string;
    autoNumber?: string;
  }): string {
    const a = overrides?.area !== undefined ? overrides.area : paciArea;
    const b = overrides?.block !== undefined ? overrides.block : paciBlock;
    const s = overrides?.street !== undefined ? overrides.street : paciStreet;
    const av = overrides?.avenue !== undefined ? overrides.avenue : paciAvenue;
    const h = overrides?.house !== undefined ? overrides.house : paciHouse;
    const fl = overrides?.floor !== undefined ? overrides.floor : paciFloor;
    const ap = overrides?.apt !== undefined ? overrides.apt : paciApt;
    const num = overrides?.autoNumber !== undefined ? overrides.autoNumber : paciAutoNumber;

    const parts = [
      a.trim(),
      b.trim() ? `ق ${b.trim()}` : '',
      s.trim() ? `ش ${s.trim()}` : '',
      av.trim() ? `جادة ${av.trim()}` : '',
      h.trim() ? `منزل ${h.trim()}` : '',
      fl.trim() ? `دور ${fl.trim()}` : '',
      ap.trim() ? `شقة ${ap.trim()}` : '',
      num.trim() ? `[الرقم الآلي: ${num.trim()}]` : '',
    ].filter(Boolean);

    return parts.join(' - ');
  }
  
  // Tab: 'desk' | 'recent_calls' | 'hardware'
  const [activeTab, setActiveTab] = useState<'desk' | 'recent_calls' | 'hardware'>('desk');
  const [recentCallsList, setRecentCallsList] = useState<CallerIdCallEvent[]>([]);

  // New Customer Form State
  const [newName, setNewName] = useState(initialName);
  const [newPhone, setNewPhone] = useState(initialPhone);
  const [newAddress, setNewAddress] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Hardware caller ID status
  const [isSerialConnected, setIsSerialConnected] = useState(callerIdService.isConnected());
  const [isConnectingHardware, setIsConnectingHardware] = useState(false);
  const isSerialSupported = callerIdService.isSupported();

  // Load active delivery reps
  const deliveryRepsQuery = useQuery({
    queryKey: ['delivery-reps'],
    queryFn: deliveryRepsApi.list,
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  const deliveryReps = useMemo(() => {
    const list = deliveryRepsQuery.data || [];
    return list.filter((r: DeliveryRep) => r.is_active !== false);
  }, [deliveryRepsQuery.data]);

  // Sync recent calls on open & subscribe
  useEffect(() => {
    if (open) {
      setRecentCallsList(callerIdService.getRecentCalls());
      const unsub = callerIdService.subscribe(() => {
        setRecentCallsList(callerIdService.getRecentCalls());
      });
      return () => unsub();
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      if (initialPhone) {
        setPhoneQuery(initialPhone);
        setNewPhone(initialPhone);
      }
      if (initialName) {
        setNewName(initialName);
      }
      const frame = window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [open, initialPhone, initialName]);

  const trimmedQuery = phoneQuery.trim();
  const cleanDigits = phoneQuery.replace(/\D/g, '');
  const isTextSearch = /[^\d\s\-+()]/.test(trimmedQuery);

  // International Gold Standard Search Trigger:
  // Phone numbers: >= 6 digits (eliminates 010, 011, 012 operator collision)
  // Text/Name: >= 2 characters
  const isSearchActive = isTextSearch ? trimmedQuery.length >= 2 : cleanDigits.length >= 6;
  const searchParam = isTextSearch ? trimmedQuery : cleanDigits;

  const deliveryLookupQuery = useQuery<PosCustomerDeliveryProfile>({
    queryKey: ['posCustomerDeliveryLookup', searchParam],
    queryFn: () => posApi.customerDeliveryLookup(searchParam),
    enabled: open && isSearchActive && !selectedCustomerId,
    staleTime: 15_000,
  });

  const specificProfileQuery = useQuery<PosCustomerDeliveryProfile>({
    queryKey: ['posCustomerDeliveryProfile', selectedCustomerId],
    queryFn: () => posApi.customerDeliveryProfile(selectedCustomerId!),
    enabled: open && Boolean(selectedCustomerId),
    staleTime: 15_000,
  });

  const profileData = selectedCustomerId ? specificProfileQuery.data : deliveryLookupQuery.data;

  // Active customer is either:
  // 1. Explicitly selected candidate
  // 2. Exact 1-to-1 match from phone lookup / caller ID
  const currentCustomer = selectedCustomerId
    ? specificProfileQuery.data?.customer
    : (deliveryLookupQuery.data?.isExactMatch ? deliveryLookupQuery.data?.customer : null);

  const matchedCustomers = deliveryLookupQuery.data?.matchedCustomers || [];
  const addresses = useMemo(() => profileData?.addresses || [], [profileData?.addresses]);
  const recentOrders = useMemo(() => profileData?.recentOrders || [], [profileData?.recentOrders]);

  // Update selected address when profile loads
  useEffect(() => {
    if (currentCustomer && addresses.length > 0 && !selectedAddress && !isCustomAddressMode) {
      setSelectedAddress(addresses[0] || currentCustomer.address || '');
    } else if (currentCustomer && currentCustomer.address && !selectedAddress && !isCustomAddressMode) {
      setSelectedAddress(currentCustomer.address);
    }
  }, [currentCustomer, addresses, selectedAddress, isCustomAddressMode]);

  // Zone selection calculation
  const currentDeliveryFee = useMemo(() => {
    if (selectedZoneId === 'zone_custom') return customDeliveryFee;
    const found = deliveryZones.find((z) => z.id === selectedZoneId);
    return found ? found.fee : (isKwd ? 1.000 : 15);
  }, [selectedZoneId, customDeliveryFee, deliveryZones, isKwd]);

  function handleZoneChange(zoneId: string) {
    setSelectedZoneId(zoneId);
    const found = deliveryZones.find((z) => z.id === zoneId);
    if (found) {
      if (zoneId !== 'zone_custom') {
        setCustomDeliveryFee(found.fee);
      }
      setEtaMinutes(found.eta);
    }
  }

  // Construct combined delivery & payment operational note
  function buildCombinedNote(): string {
    const parts: string[] = [];

    // Zone & ETA
    const zoneObj = deliveryZones.find((z) => z.id === selectedZoneId);
    const zoneName = zoneObj ? zoneObj.name : 'توصيل';
    parts.push(`[التوصيل: ${zoneName} - ${currentDeliveryFee} ${currencySym} | الوقت المتوقع: ${etaMinutes} دقيقة]`);

    // Payment method at doorstep
    if (paymentMethodAtDoor === 'cash') {
      if (customerPaidNote.trim()) {
        parts.push(`[الدفع: كاش عند الاستلام | العميل يدفع: ${customerPaidNote.trim()} ${currencySym} - تجهيز فكة للطيار]`);
      } else {
        parts.push(`[الدفع: كاش عند الاستلام]`);
      }
    } else if (paymentMethodAtDoor === 'card_pos') {
      parts.push(
        isKwd
          ? `[الدفع: كي نت مع الطيار (K-NET) | اصطحاب ماكينة الدفع المحمولة]`
          : isKsa
          ? `[الدفع: مدى مع الطيار (mada) | اصطحاب ماكينة الدفع المحمولة]`
          : `[الدفع: فيزا مع الطيار | اصطحاب ماكينة POS المحمولة]`
      );
    } else if (paymentMethodAtDoor === 'instapay_wallet') {
      parts.push(
        isKwd
          ? `[الدفع: رابط دفع إلكتروني (K-NET Payment Link)]`
          : isKsa
          ? `[الدفع: STC Pay / محفظة رقمية]`
          : `[الدفع: إنستاباي / محفظة إلكترونية]`
      );
    }

    if (deliveryNotes.trim()) {
      parts.push(`[ملاحظات الطيار: ${deliveryNotes.trim()}]`);
    }

    if (paciAutoNumber.trim()) {
      parts.push(`[الرقم الآلي للعنوان: ${paciAutoNumber.trim()}]`);
    }

    return parts.join(' ');
  }

  // Quick Customer Creation Mutation
  const createCustomerMutation = useMutation({
    mutationFn: async (payload: { name: string; phone: string; address: string; notes?: string }) => {
      return catalogApi.createCustomer({
        name: payload.name.trim(),
        phone: payload.phone.trim(),
        address: payload.address.trim(),
        balance: 0,
        type: 'cash',
        creditLimit: 0,
        metadata: payload.notes ? { notes: payload.notes } : undefined,
      });
    },
    onSuccess: async (created: any) => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['posCustomers'] });
      
      const createdId = String(created?.id || created?.customer?.id || '');
      const assignedAddress = newAddress.trim() 
        ? `${addressTag === 'work' ? '[العمل] ' : addressTag === 'home' ? '[المنزل] ' : ''}${newAddress.trim()}`
        : '';
      
      toast.success('تم تسجيل العميل بنجاح وتجهيز طلب التوصيل');
      
      if (createdId) {
        pos.setCustomerId(createdId);
      }
      pos.setQuickCustomerName(newName.trim());
      pos.setQuickCustomerPhone(newPhone.trim());
      pos.setQuickCustomerAddress(assignedAddress);
      pos.setOrderType('delivery');
      pos.setDeliveryFee(currentDeliveryFee);
      if (selectedDriverId) {
        pos.setDeliveryRepId(selectedDriverId);
      }
      
      const note = buildCombinedNote();
      if (note) {
        pos.setNote(note);
      }
      
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر تسجيل بيانات العميل');
    },
  });

  // Add address to customer profile mutation
  const addAddressMutation = useMutation({
    mutationFn: async ({ customerId, address }: { customerId: string; address: string }) => {
      return posApi.addCustomerAddress(customerId, address);
    },
    onSuccess: async (_, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['posCustomerDeliveryLookup'] });
      await queryClient.invalidateQueries({ queryKey: ['posCustomerDeliveryProfile', vars.customerId] });
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      setSelectedAddress(vars.address);
      setIsCustomAddressMode(false);
      setCustomAddressInput('');
      toast.success('تم حفظ العنوان الجديد للعميل بنجاح');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر حفظ العنوان');
    },
  });

  // Delete address from customer profile mutation
  const deleteAddressMutation = useMutation({
    mutationFn: async ({ customerId, address }: { customerId: string; address: string }) => {
      return posApi.deleteCustomerAddress(customerId, address);
    },
    onSuccess: async (_, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['posCustomerDeliveryLookup'] });
      await queryClient.invalidateQueries({ queryKey: ['posCustomerDeliveryProfile', vars.customerId] });
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      if (selectedAddress === vars.address) {
        setSelectedAddress('');
      }
      toast.info('تم حذف العنوان بنجاح');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر حذف العنوان');
    },
  });

  function handleSaveCustomAddress() {
    if (!currentCustomer) return;
    const raw = customAddressInput.trim();
    if (!raw) {
      toast.warning('يرجى كتابة تفاصيل العنوان أولاً');
      return;
    }
    const tagPrefix = addressTag === 'work' ? '[العمل] ' : addressTag === 'home' ? '[المنزل] ' : '';
    const formatted = `${tagPrefix}${raw}`;
    addAddressMutation.mutate({ customerId: String(currentCustomer.id), address: formatted });
  }

  // Re-order handler: reconstructs cart from previous sale
  function handleReorder(order: PosCustomerDeliveryProfileOrder) {
    if (!currentCustomer) return;
    const rawAddress = isCustomAddressMode ? customAddressInput.trim() : (selectedAddress || currentCustomer.address || '');
    const finalAddress = isCustomAddressMode && rawAddress
      ? `${addressTag === 'work' ? '[العمل] ' : addressTag === 'home' ? '[المنزل] ' : ''}${rawAddress}`
      : rawAddress;

    // Automatically persist custom address if typed
    if (isCustomAddressMode && rawAddress) {
      posApi.addCustomerAddress(currentCustomer.id, finalAddress).then(() => {
        queryClient.invalidateQueries({ queryKey: ['posCustomerDeliveryLookup'] });
        queryClient.invalidateQueries({ queryKey: ['posCustomerDeliveryProfile', currentCustomer.id] });
      }).catch(() => {});
    }

    const productsCatalog = pos.productsQuery.data || [];
    const newCart: PosItem[] = [];

    for (let idx = 0; idx < order.items.length; idx++) {
      const orderItem = order.items[idx];
      const matchedProduct = productsCatalog.find(
        (p) => String(p.id) === String(orderItem.productId) || p.name.trim().toLowerCase() === orderItem.name.trim().toLowerCase()
      );

      const unitId = matchedProduct?.units?.[0]?.id ? String(matchedProduct.units[0].id) : 'default';
      const unitName = orderItem.unitName || matchedProduct?.units?.[0]?.name || 'قطعة';
      const unitMultiplier = orderItem.unitMultiplier || matchedProduct?.units?.[0]?.multiplier || 1;
      const currentPrice = matchedProduct ? Number(matchedProduct.retailPrice || 0) : Number(orderItem.unitPrice || 0);

      newCart.push({
        lineKey: `reorder-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
        productId: String(orderItem.productId || matchedProduct?.id || `custom-${idx}`),
        name: orderItem.name,
        itemCode: matchedProduct?.barcode || matchedProduct?.sku || '',
        unitId,
        unitName,
        unitMultiplier,
        price: currentPrice > 0 ? currentPrice : Number(orderItem.unitPrice || 0),
        costPrice: Number(matchedProduct?.costPrice || 0),
        qty: Number(orderItem.qty || 1),
        stockLimit: Number(matchedProduct?.stock || 9999),
        currentStock: Number(matchedProduct?.stock || 9999),
        minStock: Number(matchedProduct?.minStock || 0),
        priceType: 'retail',
        modifiers: orderItem.modifiers || [],
        notes: orderItem.notes || '',
      });
    }

    // Populate POS workspace
    pos.setCart(newCart);
    pos.setCustomerId(String(currentCustomer.id));
    pos.setQuickCustomerName(currentCustomer.name);
    pos.setQuickCustomerPhone(currentCustomer.phone);
    pos.setQuickCustomerAddress(finalAddress);
    pos.setOrderType('delivery');
    pos.setDeliveryFee(currentDeliveryFee > 0 ? currentDeliveryFee : (order.deliveryFee || 0));
    if (selectedDriverId) {
      pos.setDeliveryRepId(selectedDriverId);
    }
    
    const note = buildCombinedNote();
    if (note) {
      pos.setNote(note);
    }

    toast.success(`تم تكرار الطلب (${order.docNo}) بنجاح وتعبئة السلة بـ ${newCart.length} صنف.`);
    onClose();
  }

  // Start new empty delivery order for this customer
  function handleStartNewOrder() {
    if (!currentCustomer) return;
    const rawAddress = isCustomAddressMode ? customAddressInput.trim() : (selectedAddress || currentCustomer.address || '');
    const finalAddress = isCustomAddressMode && rawAddress
      ? `${addressTag === 'work' ? '[العمل] ' : addressTag === 'home' ? '[المنزل] ' : ''}${rawAddress}`
      : rawAddress;

    // Automatically persist custom address if typed
    if (isCustomAddressMode && rawAddress) {
      posApi.addCustomerAddress(currentCustomer.id, finalAddress).then(() => {
        queryClient.invalidateQueries({ queryKey: ['posCustomerDeliveryLookup'] });
        queryClient.invalidateQueries({ queryKey: ['posCustomerDeliveryProfile', currentCustomer.id] });
      }).catch(() => {});
    }

    pos.setCustomerId(String(currentCustomer.id));
    pos.setQuickCustomerName(currentCustomer.name);
    pos.setQuickCustomerPhone(currentCustomer.phone);
    pos.setQuickCustomerAddress(finalAddress);
    pos.setOrderType('delivery');
    pos.setDeliveryFee(currentDeliveryFee);
    if (selectedDriverId) {
      pos.setDeliveryRepId(selectedDriverId);
    }
    
    const note = buildCombinedNote();
    if (note) {
      pos.setNote(note);
    }

    toast.info(`تم تعيين العميل (${currentCustomer.name}) وتجهيز بيانات التوصيل.`);
    onClose();
  }

  // Hardware connection handler
  async function handleConnectHardware() {
    setIsConnectingHardware(true);
    try {
      const res = await callerIdService.requestDeviceConnection(9600);
      if (res.success) {
        setIsSerialConnected(true);
        toast.success('تم الاتصال بجهاز كاشف المتصل (Caller ID) بنجاح');
      } else {
        toast.error(res.error || 'تعذر الاتصال بالجهاز');
      }
    } finally {
      setIsConnectingHardware(false);
    }
  }

  function handleSimulateCall() {
    const testPhones = ['01012345678', '01122334455', '01299887766', '01500112233'];
    const randomPhone = testPhones[Math.floor(Math.random() * testPhones.length)];
    callerIdService.simulateCall(randomPhone, 'عميل تجريبي');
    toast.info(`تم إرسال إشارة رنين تجريبية للرقم ${randomPhone}`);
    setPhoneQuery(randomPhone);
    setRecentCallsList(callerIdService.getRecentCalls());
    setActiveTab('desk');
  }

  function handlePickRecentCall(phone: string) {
    setPhoneQuery(phone);
    setSelectedCustomerId(null);
    setSelectedAddress('');
    setActiveTab('desk');
  }

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      compact
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <PhoneCallIcon size={18} color="#170e5e" />
          <span>{t('pos.pos_workspace.pos_phone_order_dialog.s0', "مكتب طلبات الهاتف والتوصيل السريع (Phone Order Desk)")}</span>
        </div>
      }
      subtitle={t('pos.pos_workspace.pos_phone_order_dialog.s1', "استقبال مكالمات العملاء، كاشف الأرقام، تجهيز فكة الطيار، وتكرار الطلبات بضغطة واحدة")}
      width="1180px"
      maxWidth="96vw"
      minHeight="auto"
      badge={
        <PosPhoneOrderDialogTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          recentCallsList={recentCallsList}
          isSerialConnected={isSerialConnected}
        />
      }
      footer={
        <PosPhoneOrderDialogFooter
          currentCustomer={currentCustomer}
          isSearchActive={isSearchActive}
          phoneQuery={phoneQuery}
          onClose={onClose}
          activeTab={activeTab}
          pos={pos}
          currentDeliveryFee={currentDeliveryFee}
          currencySym={currencySym}
          isKwd={isKwd}
          isKsa={isKsa}
          handleStartNewOrder={handleStartNewOrder}
        />
      }
    >
      {activeTab === 'recent_calls' ? (
        /* Recent Incoming Calls Log Tab */
        <PosPhoneOrderRecentCalls
          recentCallsList={recentCallsList}
          setRecentCallsList={setRecentCallsList}
          handleSimulateCall={handleSimulateCall}
          handlePickRecentCall={handlePickRecentCall}
        />
      ) : activeTab === 'hardware' ? (
        /* Hardware Configuration Tab */
        <PosPhoneOrderDialogHardware
          isSerialConnected={isSerialConnected}
          isSerialSupported={isSerialSupported}
          isConnectingHardware={isConnectingHardware}
          handleConnectHardware={handleConnectHardware}
          handleSimulateCall={handleSimulateCall}
        />
      ) : (
        /* Order Desk Tab */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Top Phone Search Bar */}
          <div
            style={{
              background: '#f8fafc',
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                ref={searchInputRef}
                type="text"
                value={phoneQuery}
                onChange={(e) => {
                  setPhoneQuery(e.target.value);
                  setSelectedCustomerId(null);
                  setSelectedAddress('');
                  setIsForceNewCustomer(false);
                  setNewPhone(e.target.value);
                }}
                placeholder={
                  isKwd
                    ? t('pos.pos_workspace.pos_phone_order_dialog.s37', "أدخل رقم هاتف العميل بالكويت (8 أرقام مثال: 91234567) أو اسم العميل...")
                    : isKsa
                    ? t('pos.pos_workspace.pos_phone_order_dialog.s38', "أدخل رقم هاتف العميل بالسعودية (مثال: 0501234567) أو اسم العميل...")
                    : t('pos.pos_workspace.pos_phone_order_dialog.s39', "أدخل رقم هاتف العميل (مثال: 01012345678) أو اسم العميل...")
                }
                style={{
                  width: '100%',
                  padding: '6px 32px 6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#0f172a',
                  background: '#ffffff',
                  outline: 'none',
                }}
              />
              <SearchIcon
                size={16}
                color="#94a3b8"
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)' }}
              />
              {phoneQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setPhoneQuery('');
                    setSelectedCustomerId(null);
                    setSelectedAddress('');
                    setIsForceNewCustomer(false);
                    searchInputRef.current?.focus();
                  }}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '2px',
                  }}
                >
                  <XIcon size={13} />
                </button>
              )}
            </div>

            {deliveryLookupQuery.isFetching && (
              <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <RefreshCwIcon size={13} className="spin" />
                <span>{t('pos.pos_workspace.pos_phone_order_dialog.s40', "جاري البحث...")}</span>
              </div>
            )}
          </div>

          {/* Main Content Area */}
          {!currentCustomer && !isSearchActive ? (
            /* Empty prompt state */
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '36px 20px',
                textAlign: 'center',
                background: '#f8fafc',
                borderRadius: '10px',
                border: '1px dashed #cbd5e1',
              }}
            >
              <PhoneIcon size={36} color="#94a3b8" style={{ marginBottom: '8px' }} />
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('pos.pos_workspace.pos_phone_order_dialog.s41', "مكتب استقبال طلبات الهاتف والتوصيل السريع")}
              </div>
              <p style={{ fontSize: '0.78rem', color: '#64748b', maxWidth: '440px', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                {t('pos.pos_workspace.pos_phone_order_dialog.s42', "أدخل")} <strong>{t('pos.pos_workspace.pos_phone_order_dialog.s43', "6 أرقام على الأقل")}</strong> {t('pos.pos_workspace.pos_phone_order_dialog.s44', "للبحث برقم الهاتف لتجاوز بادئة شركات المحمول (010 / 011 / 012 / 015)، أو ابدأ بكتابة اسم العميل.")}
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setActiveTab('recent_calls')}
                  style={{ fontSize: '0.75rem', fontWeight: 700 }}
                >
                  <ClockIcon size={12} style={{ marginLeft: '4px' }} />
                  {t('pos.pos_workspace.pos_phone_order_dialog.s45', "سجل المكالمات الواردة")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setIsForceNewCustomer(true);
                    setNewPhone(phoneQuery || '');
                  }}
                  style={{ fontSize: '0.75rem', fontWeight: 700 }}
                >
                  <PlusIcon size={12} style={{ marginLeft: '4px' }} />
                  {t('pos.pos_workspace.pos_phone_order_dialog.s46', "تسجيل عميل جديد مباشرة")}
                </Button>
              </div>
            </div>
          ) : currentCustomer ? (
            /* STATE 1: Existing / Selected Customer Workspace */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Active Customer Strip */}
              <div
                style={{
                  background: '#eff6ff',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid #bfdbfe',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '50%',
                      background: '#1e40af',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <UserIcon size={14} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e3a8a' }}>
                      {t('pos.pos_workspace.pos_phone_order_dialog.s47', "العميل النشط:")} {currentCustomer.name}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#3b82f6', fontWeight: 600 }}>
                      ({currentCustomer.phone || t('pos.pos_workspace.pos_phone_order_dialog.s48', "بدون رقم")})
                    </span>
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: currentCustomer.customerType === 'vip' ? '#fef3c7' : '#e0e7ff',
                        color: currentCustomer.customerType === 'vip' ? '#92400e' : '#3730a3',
                      }}
                    >
                      {currentCustomer.customerType === 'vip' ? 'VIP' : t('pos.pos_workspace.pos_phone_order_dialog.s49', "نقدي")}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSelectedCustomerId(null);
                    setSelectedAddress('');
                    setIsForceNewCustomer(false);
                    searchInputRef.current?.focus();
                  }}
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '3px 8px',
                    background: '#ffffff',
                    border: '1px solid #93c5fd',
                    color: '#1e40af',
                  }}
                >
                  <SearchIcon size={12} style={{ marginLeft: '4px' }} />
                  {t('pos.pos_workspace.pos_phone_order_dialog.s50', "تغيير العميل")}
                </Button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: '10px' }}>
                {/* Left Column: Customer Profile, Addresses, Zone & Payment */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* Customer Quick Stats & Address Card */}
                  <div
                    style={{
                      background: '#ffffff',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    {/* Stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                      <div style={{ background: '#f8fafc', padding: '4px 6px', borderRadius: '6px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_phone_order_dialog.s51', "إجمالي الطلبات")}</div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1e293b' }}>
                          {profileData?.stats?.invoiceCount || 0}
                        </div>
                      </div>
                      <div style={{ background: '#f8fafc', padding: '4px 6px', borderRadius: '6px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_phone_order_dialog.s52', "إجمالي المشتريات")}</div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#170e5e' }}>
                          {formatCurrency(profileData?.stats?.totalSalesAmount || 0)}
                        </div>
                      </div>
                      <div style={{ background: '#f8fafc', padding: '4px 6px', borderRadius: '6px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_phone_order_dialog.s53', "نقاط الولاء")}</div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#059669' }}>
                          {currentCustomer.loyaltyPoints || 0}
                        </div>
                      </div>
                    </div>

                    {/* Customer notes if any */}
                    {currentCustomer.notes && (
                      <div style={{ background: '#fffbeb', padding: '3px 8px', borderRadius: '4px', border: '1px solid #fef3c7', fontSize: '0.7rem', color: '#92400e' }}>
                        <strong>{t('pos.pos_workspace.pos_phone_order_dialog.s54', "ملاحظات:")}</strong> {currentCustomer.notes}
                      </div>
                    )}

                    {/* Delivery Address Selector */}
                    <div style={{ borderTop: '1px dashed #e2e8f0', paddingTop: '5px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <MapPinIcon size={12} color="#2563eb" />
                          <span>{t('pos.pos_workspace.pos_phone_order_dialog.s55', "عنوان التوصيل")}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsCustomAddressMode(!isCustomAddressMode)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#2563eb',
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          {isCustomAddressMode ? t('pos.pos_workspace.pos_phone_order_dialog.s56', "اختيار من العناوين المحفوظة") : t('pos.pos_workspace.pos_phone_order_dialog.s57', "+ عنوان جديد")}
                        </button>
                      </div>

                      {isCustomAddressMode ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            {(['home', 'work', 'other'] as const).map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => setAddressTag(tag)}
                                style={{
                                  background: addressTag === tag ? '#2563eb' : '#f1f5f9',
                                  color: addressTag === tag ? '#ffffff' : '#475569',
                                  border: 'none',
                                  borderRadius: '4px',
                                  padding: '2px 6px',
                                  fontSize: '0.65rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                {tag === 'home' ? t('pos.pos_workspace.pos_phone_order_dialog.s58', "المنزل") : tag === 'work' ? t('pos.pos_workspace.pos_phone_order_dialog.s59', "العمل") : t('pos.pos_workspace.pos_phone_order_dialog.s60', "أخرى")}
                              </button>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <input
                              type="text"
                              value={customAddressInput}
                              onChange={(e) => setCustomAddressInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveCustomAddress();
                                }
                              }}
                              placeholder={isKwd ? t('pos.pos_workspace.pos_phone_order_dialog.s61', "اكتب العنوان بالتفصيل (المنطقة، قطعة، شارع، منزل، والرقم الآلي للعنوان)...") : t('pos.pos_workspace.pos_phone_order_dialog.s62', "اكتب العنوان بالتفصيل (المنطقة، الشارع، العقار، الدور)...")}
                              style={{
                                flex: 1,
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid #cbd5e1',
                                fontSize: '0.75rem',
                                outline: 'none',
                              }}
                            />
                            <button
                              type="button"
                              onClick={handleSaveCustomAddress}
                              disabled={addAddressMutation.isPending || !customAddressInput.trim()}
                              style={{
                                background: '#10b981',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                padding: '4px 8px',
                                fontSize: '0.6875rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                                whiteSpace: 'nowrap',
                                opacity: !customAddressInput.trim() ? 0.6 : 1,
                              }}
                              title={t('pos.pos_workspace.pos_phone_order_dialog.s63', "حفظ هذا العنوان في ملف العميل دائماً")}
                            >
                              <PlusIcon size={12} />
                              <span>{t('pos.pos_workspace.pos_phone_order_dialog.s64', "حفظ العنوان")}</span>
                            </button>
                          </div>
                        </div>
                      ) : addresses.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '80px', overflowY: 'auto' }}>
                          {addresses.map((addr, idx) => {
                            const isSelected = selectedAddress === addr;
                            const isHome = addr.startsWith(t('pos.pos_workspace.pos_phone_order_dialog.s65', "[المنزل]"));
                            const isWork = addr.startsWith(t('pos.pos_workspace.pos_phone_order_dialog.s66', "[العمل]"));
                            const displayAddr = addr.replace(/^\[(المنزل|العمل|أخرى)\]\s*/, '');
                            const tagLabel = isHome ? t('pos.pos_workspace.pos_phone_order_dialog.s67', "المنزل") : isWork ? t('pos.pos_workspace.pos_phone_order_dialog.s68', "العمل") : null;

                            return (
                              <div
                                key={idx}
                                onClick={() => setSelectedAddress(addr)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: '6px',
                                  padding: '3px 8px',
                                  borderRadius: '4px',
                                  border: isSelected ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                                  background: isSelected ? '#eff6ff' : '#ffffff',
                                  cursor: 'pointer',
                                  fontSize: '0.72rem',
                                  fontWeight: isSelected ? 700 : 500,
                                  color: isSelected ? '#1e40af' : '#334155',
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                                  <input
                                    type="radio"
                                    name="delivery_address"
                                    checked={isSelected}
                                    onChange={() => setSelectedAddress(addr)}
                                    style={{ accentColor: '#2563eb', margin: 0 }}
                                  />
                                  {tagLabel && (
                                    <span
                                      style={{
                                        background: isHome ? '#e0f2fe' : '#fef3c7',
                                        color: isHome ? '#0369a1' : '#b45309',
                                        fontSize: '0.625rem',
                                        fontWeight: 700,
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {tagLabel}
                                    </span>
                                  )}
                                  <span style={{ flex: 1, wordBreak: 'break-word', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {displayAddr}
                                  </span>
                                </div>
                                {currentCustomer && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteAddressMutation.mutate({ customerId: String(currentCustomer.id), address: addr });
                                    }}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: '#94a3b8',
                                      cursor: 'pointer',
                                      padding: '2px',
                                      borderRadius: '3px',
                                      display: 'flex',
                                      alignItems: 'center',
                                    }}
                                    title={t('pos.pos_workspace.pos_phone_order_dialog.s69', "حذف هذا العنوان")}
                                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                                    onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                                  >
                                    <TrashIcon size={11} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', padding: '4px', textAlign: 'center', background: '#f8fafc', borderRadius: '4px' }}>
                          {t('pos.pos_workspace.pos_phone_order_dialog.s70', "لا يوجد عناوين سابقة مسجلة لهذا العميل. اضغط على \"+ عنوان جديد\" لإضافة عنوان.")}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Delivery Zone, Fees, Driver & Payment Setup */}
                  <div
                    style={{
                      background: '#ffffff',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '6px' }}>
                      <div>
                        <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>
                          {t('pos.pos_workspace.pos_phone_order_dialog.s71', "منطقة التوصيل والرسوم")}
                        </label>
                        <select
                          value={selectedZoneId}
                          onChange={(e) => handleZoneChange(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '4px 6px',
                            borderRadius: '4px',
                            border: '1px solid #cbd5e1',
                            fontSize: '0.72rem',
                            background: '#ffffff',
                          }}
                        >
                          {deliveryZones.map((z) => (
                            <option key={z.id} value={z.id}>
                              {z.name} ({z.fee} {currencySym})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>
                          {t('pos.pos_workspace.pos_phone_order_dialog.s72', "تعيين الطيار (اختياري)")}
                        </label>
                        <select
                          value={selectedDriverId}
                          onChange={(e) => setSelectedDriverId(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '4px 6px',
                            borderRadius: '4px',
                            border: '1px solid #cbd5e1',
                            fontSize: '0.72rem',
                            background: '#ffffff',
                          }}
                        >
                          <option value="">{t('pos.pos_workspace.pos_phone_order_dialog.s73', "توزيع تلقائي لاحقاً")}</option>
                          {deliveryReps.map((dr: DeliveryRep) => (
                            <option key={dr.id} value={dr.id}>
                              {dr.name} {dr.phone ? `(${dr.phone})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {selectedZoneId === 'zone_custom' && (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{t('pos.pos_workspace.pos_phone_order_dialog.s74', "رسوم التوصيل:")}</span>
                        <input
                          type="number"
                          min="0"
                          step={isKwd ? "0.050" : "1"}
                          value={customDeliveryFee}
                          onChange={(e) => setCustomDeliveryFee(Number(e.target.value) || 0)}
                          style={{ width: '65px', padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
                        />
                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{currencySym}</span>
                      </div>
                    )}

                    {/* Payment at Doorstep Selector */}
                    <div style={{ paddingTop: '4px', borderTop: '1px dashed #e2e8f0' }}>
                      <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>
                        {t('pos.pos_workspace.pos_phone_order_dialog.s75', "طريقة الدفع عند الاستلام")}
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                        <button
                          type="button"
                          onClick={() => setPaymentMethodAtDoor('cash')}
                          style={{
                            background: paymentMethodAtDoor === 'cash' ? '#170e5e' : '#f8fafc',
                            color: paymentMethodAtDoor === 'cash' ? '#ffffff' : '#334155',
                            border: '1px solid',
                            borderColor: paymentMethodAtDoor === 'cash' ? '#170e5e' : '#cbd5e1',
                            borderRadius: '4px',
                            padding: '3px 2px',
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '3px',
                          }}
                        >
                          <DollarSignIcon size={11} />
                          {t('pos.pos_workspace.pos_phone_order_dialog.s76', "كاش")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMethodAtDoor('card_pos')}
                          style={{
                            background: paymentMethodAtDoor === 'card_pos' ? '#170e5e' : '#f8fafc',
                            color: paymentMethodAtDoor === 'card_pos' ? '#ffffff' : '#334155',
                            border: '1px solid',
                            borderColor: paymentMethodAtDoor === 'card_pos' ? '#170e5e' : '#cbd5e1',
                            borderRadius: '4px',
                            padding: '3px 2px',
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '3px',
                          }}
                        >
                          <CreditCardIcon size={11} />
                          {isKwd ? t('pos.pos_workspace.pos_phone_order_dialog.s77', "كي نت مع المندوب") : isKsa ? t('pos.pos_workspace.pos_phone_order_dialog.s78', "مدى مع المندوب") : t('pos.pos_workspace.pos_phone_order_dialog.s79', "فيزا مع الطيار")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMethodAtDoor('instapay_wallet')}
                          style={{
                            background: paymentMethodAtDoor === 'instapay_wallet' ? '#170e5e' : '#f8fafc',
                            color: paymentMethodAtDoor === 'instapay_wallet' ? '#ffffff' : '#334155',
                            border: '1px solid',
                            borderColor: paymentMethodAtDoor === 'instapay_wallet' ? '#170e5e' : '#cbd5e1',
                            borderRadius: '4px',
                            padding: '3px 2px',
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '3px',
                          }}
                        >
                          {isKwd ? t('pos.pos_workspace.pos_phone_order_dialog.s80', "رابط دفع أونلاين") : isKsa ? t('pos.pos_workspace.pos_phone_order_dialog.s81', "تحويل / STC Pay") : t('pos.pos_workspace.pos_phone_order_dialog.s82', "إنستاباي / محفظة")}
                        </button>
                      </div>

                      {paymentMethodAtDoor === 'cash' && (
                        <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.65rem', color: '#64748b', whiteSpace: 'nowrap' }}>{t('pos.pos_workspace.pos_phone_order_dialog.s83', "العميل يدفع:")}</span>
                          <input
                            type="text"
                            value={customerPaidNote}
                            onChange={(e) => setCustomerPaidNote(e.target.value)}
                            placeholder={isKwd ? t('pos.pos_workspace.pos_phone_order_dialog.s84', "مثال: 10 د.ك...") : isKsa ? t('pos.pos_workspace.pos_phone_order_dialog.s85', "مثال: 100 ر.س...") : t('pos.pos_workspace.pos_phone_order_dialog.s86', "مثال: 200 ج...")}
                            style={{
                              flex: 1,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              border: '1px solid #cbd5e1',
                              fontSize: '0.7rem',
                            }}
                          />
                          <div style={{ display: 'flex', gap: '2px' }}>
                            {(isKwd ? ['5', '10', '20'] : isKsa ? ['50', '100', '200'] : ['100', '200', '500']).map((val) => (
                              <button
                                key={val}
                                type="button"
                                onClick={() => setCustomerPaidNote(val)}
                                style={{
                                  background: '#f1f5f9',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '3px',
                                  padding: '1px 4px',
                                  fontSize: '0.65rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                {val}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Delivery Note input */}
                    <div>
                      <input
                        type="text"
                        value={deliveryNotes}
                        onChange={(e) => setDeliveryNotes(e.target.value)}
                        placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s87', "توجيهات للطيار (مثال: رن الجرس مرتين، بجوار صيدلية العزبي)...")}
                        style={{
                          width: '100%',
                          padding: '3px 6px',
                          borderRadius: '4px',
                          border: '1px solid #cbd5e1',
                          fontSize: '0.72rem',
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Right Column: Order History & 1-Click Repeat */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <ReceiptIcon size={13} color="#170e5e" />
                      <span>{t('pos.pos_workspace.pos_phone_order_dialog.s88', "سجل طلبات العميل السابقة")}</span>
                    </div>
                    <span style={{ fontSize: '0.6875rem', color: '#64748b' }}>
                      {recentOrders.length} {t('pos.pos_workspace.pos_phone_order_dialog.s89', "طلبات مسجلة")}
                    </span>
                  </div>

                  {recentOrders.length === 0 ? (
                    <div
                      style={{
                        background: '#f8fafc',
                        padding: '24px 12px',
                        borderRadius: '8px',
                        border: '1px dashed #cbd5e1',
                        textAlign: 'center',
                      }}
                    >
                      <ClockIcon size={24} color="#94a3b8" style={{ marginBottom: '4px' }} />
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                        {t('pos.pos_workspace.pos_phone_order_dialog.s90', "لا توجد طلبات سابقة مسجلة لهذا العميل")}
                      </div>
                      <p style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px', marginBottom: '8px' }}>
                        {t('pos.pos_workspace.pos_phone_order_dialog.s91', "يمكنك بدء أول طلب له وسيقوم النظام بحفظ عنوانه وتفضيلاته تلقائياً.")}
                      </p>
                      <Button
                        style={{ background: '#170e5e', color: '#ffffff', fontWeight: 700, fontSize: '0.72rem', padding: '3px 8px' }}
                        onClick={handleStartNewOrder}
                      >
                        <PlusIcon size={12} style={{ marginLeft: '4px' }} />
                        {t('pos.pos_workspace.pos_phone_order_dialog.s92', "بدء أول طلب للعميل")}
                      </Button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '255px', overflowY: 'auto', paddingLeft: '2px' }}>
                      {recentOrders.map((order) => (
                        <div
                          key={order.id}
                          style={{
                            background: '#ffffff',
                            borderRadius: '8px',
                            border: '1px solid #e2e8f0',
                            padding: '6px 8px',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#170e5e' }}>
                                {order.docNo}
                              </span>
                              <span style={{ fontSize: '0.65rem', color: '#64748b' }}>
                                {order.createdAt ? formatDate(order.createdAt) : ''}
                              </span>
                            </div>
                            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0f172a' }}>
                              {formatCurrency(order.total)}
                            </span>
                          </div>

                          {/* Items breakdown list */}
                          <div style={{ background: '#f8fafc', padding: '4px 6px', borderRadius: '4px', fontSize: '0.7rem', color: '#334155' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              {order.items.map((item, idx) => (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span>
                                    <strong>{item.qty}x</strong> {item.name}
                                    {item.modifiers && item.modifiers.length > 0 && (
                                      <span style={{ color: '#64748b', fontSize: '0.65rem', marginRight: '4px' }}>
                                        ({item.modifiers.map((m: any) => m.name || m).join(' + ')})
                                      </span>
                                    )}
                                  </span>
                                  <span style={{ color: '#64748b', fontWeight: 600 }}>{formatCurrency(item.lineTotal)}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Order Footer & Repeat Button */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '2px' }}>
                            <div style={{ fontSize: '0.65rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
                              {order.customerAddress ? `العنوان: ${order.customerAddress}` : t('pos.pos_workspace.pos_phone_order_dialog.s93', "بدون عنوان محدد")}
                            </div>
                            <Button
                              size="sm"
                              style={{
                                background: '#170e5e',
                                color: '#ffffff',
                                fontWeight: 700,
                                fontSize: '0.7rem',
                                padding: '2px 8px',
                                borderRadius: '4px',
                              }}
                              onClick={() => handleReorder(order)}
                            >
                              <RotateCcwIcon size={11} style={{ marginLeft: '3px' }} />
                              {t('pos.pos_workspace.pos_phone_order_dialog.s94', "تكرار هذا الطلب")}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : isSearchActive && !isForceNewCustomer && matchedCustomers.length > 0 ? (
            /* STATE 2: Candidate Customer Matches Cards Grid */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#f8fafc',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}>
                    {t('pos.pos_workspace.pos_phone_order_dialog.s95', "نتائج البحث المتطابقة")}
                  </span>
                  <span
                    style={{
                      background: '#170e5e',
                      color: '#ffffff',
                      fontSize: '0.6875rem',
                      fontWeight: 800,
                      padding: '1px 6px',
                      borderRadius: '10px',
                    }}
                  >
                    {matchedCustomers.length} {t('pos.pos_workspace.pos_phone_order_dialog.s96', "عميل")}
                  </span>
                </div>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setIsForceNewCustomer(true);
                    setNewPhone(phoneQuery || '');
                  }}
                  style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px' }}
                >
                  <PlusIcon size={12} style={{ marginLeft: '4px' }} />
                  {t('pos.pos_workspace.pos_phone_order_dialog.s97', "تسجيل عميل جديد برقم (")}{phoneQuery})
                </Button>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '8px',
                  maxHeight: '290px',
                  overflowY: 'auto',
                  padding: '2px',
                }}
              >
                {matchedCustomers.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      background: '#ffffff',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '50%',
                              background: '#f1f5f9',
                              color: '#170e5e',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <UserIcon size={14} />
                          </div>
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>
                              {c.name}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                              <PhoneIcon size={11} color="#64748b" />
                              <span>{c.phone || t('pos.pos_workspace.pos_phone_order_dialog.s98', "بدون رقم")}</span>
                            </div>
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: '3px',
                            background: c.customerType === 'vip' ? '#fef3c7' : '#f1f5f9',
                            color: c.customerType === 'vip' ? '#92400e' : '#475569',
                          }}
                        >
                          {c.customerType === 'vip' ? 'VIP' : t('pos.pos_workspace.pos_phone_order_dialog.s99', "نقدي")}
                        </span>
                      </div>

                      {c.address && (
                        <div
                          style={{
                            fontSize: '0.7rem',
                            color: '#475569',
                            background: '#f8fafc',
                            padding: '4px 6px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            marginTop: '2px',
                          }}
                        >
                          <MapPinIcon size={11} color="#64748b" />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.address}
                          </span>
                        </div>
                      )}
                    </div>

                    <Button
                      size="sm"
                      style={{
                        width: '100%',
                        background: '#170e5e',
                        color: '#ffffff',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        padding: '5px 8px',
                      }}
                      onClick={() => {
                        setSelectedCustomerId(c.id);
                        setSelectedAddress('');
                      }}
                    >
                      <ArrowLeftIcon size={13} style={{ marginLeft: '4px' }} />
                      {t('pos.pos_workspace.pos_phone_order_dialog.s100', "اختيار العميل وتجهيز الطلب")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* STATE 3: Customer Not Found / Force New Customer Form */
            <div
              style={{
                background: '#ffffff',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <PlusIcon size={16} color="#2563eb" />
                  <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                    {t('pos.pos_workspace.pos_phone_order_dialog.s101', "تسجيل عميل جديد وتجهيز طلب التوصيل")}
                  </h3>
                </div>
                {isForceNewCustomer && matchedCustomers.length > 0 && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsForceNewCustomer(false)}
                    style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px' }}
                  >
                    {t('pos.pos_workspace.pos_phone_order_dialog.s102', "العودة لنتائج البحث (")}{matchedCustomers.length})
                  </Button>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newName.trim()) {
                    toast.error(t('pos.pos_workspace.pos_phone_order_dialog.s103', "اسم العميل مطلوب"));
                    return;
                  }
                  createCustomerMutation.mutate({
                    name: newName,
                    phone: newPhone,
                    address: newAddress,
                    notes: newNotes,
                  });
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '2px' }}>
                      {t('pos.pos_workspace.pos_phone_order_dialog.s104', "اسم العميل")} <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s105', "اسم العميل الكامل...")}
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        borderRadius: '4px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.78rem',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '2px' }}>
                      {t('pos.pos_workspace.pos_phone_order_dialog.s106', "رقم الهاتف")}
                    </label>
                    <input
                      type="text"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder={
                        isKwd
                          ? t('pos.pos_workspace.pos_phone_order_dialog.s107', "رقم الهاتف بالكويت (8 أرقام)...")
                          : isKsa
                          ? t('pos.pos_workspace.pos_phone_order_dialog.s108', "رقم الهاتف بالسعودية (05xxxxxxxx)...")
                          : t('pos.pos_workspace.pos_phone_order_dialog.s109', "رقم الهاتف (مثال: 01012345678)...")
                      }
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        borderRadius: '4px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.78rem',
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#334155', margin: 0 }}>
                      {t('pos.pos_workspace.pos_phone_order_dialog.s110', "عنوان التوصيل التفصيلي (المنطقة، الشارع، العقار، الدور، الشقة)")}
                    </label>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      {(['home', 'work', 'other'] as const).map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setAddressTag(tag)}
                          style={{
                            background: addressTag === tag ? '#2563eb' : '#f1f5f9',
                            color: addressTag === tag ? '#ffffff' : '#475569',
                            border: 'none',
                            borderRadius: '3px',
                            padding: '1px 5px',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {tag === 'home' ? t('pos.pos_workspace.pos_phone_order_dialog.s111', "المنزل") : tag === 'work' ? t('pos.pos_workspace.pos_phone_order_dialog.s112', "العمل") : t('pos.pos_workspace.pos_phone_order_dialog.s113', "أخرى")}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    placeholder={
                      isKwd
                        ? t('pos.pos_workspace.pos_phone_order_dialog.s114', "مثال: حولي - ق 4 - ش تونس - جادة 2 - منزل 18 - دور 3 شقة 6")
                        : isKsa
                        ? t('pos.pos_workspace.pos_phone_order_dialog.s115', "مثال: الرياض - حي الملقا - شارع وادي حنيفة - عمارة 12 - شقة 4")
                        : t('pos.pos_workspace.pos_phone_order_dialog.s116', "مثال: المعادي - شارع 9 - عمارة 14 - الدور الثالث شقة 6")
                    }
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.78rem',
                    }}
                  />
                </div>

                {isKwd && (
                  <div style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#170e5e' }}>
                        {t('pos.pos_workspace.pos_phone_order_dialog.s117', "نموذج المعلومات المدنية الكويتية (PACI):")}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setNewAddress(buildPaciAddress());
                        }}
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          color: '#1d4ed8',
                          background: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          borderRadius: '4px',
                          padding: '2px 6px',
                          cursor: 'pointer',
                        }}
                      >
                        {t('pos.pos_workspace.pos_phone_order_dialog.s118', "توليد العنوان تلقائياً")}
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                      <input
                        type="text"
                        placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s119', "المنطقة (حولي)")}
                        value={paciArea}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPaciArea(val);
                          setNewAddress(buildPaciAddress({ area: val }));
                        }}
                        style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
                      />
                      <input
                        type="text"
                        placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s120', "القطعة (Block)")}
                        value={paciBlock}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPaciBlock(val);
                          setNewAddress(buildPaciAddress({ block: val }));
                        }}
                        style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
                      />
                      <input
                        type="text"
                        placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s121', "الشارع")}
                        value={paciStreet}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPaciStreet(val);
                          setNewAddress(buildPaciAddress({ street: val }));
                        }}
                        style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
                      />
                      <input
                        type="text"
                        placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s122', "الجادة (اختياري)")}
                        value={paciAvenue}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPaciAvenue(val);
                          setNewAddress(buildPaciAddress({ avenue: val }));
                        }}
                        style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                      <input
                        type="text"
                        placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s123', "المنزل / القسيمة / المبنى")}
                        value={paciHouse}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPaciHouse(val);
                          setNewAddress(buildPaciAddress({ house: val }));
                        }}
                        style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
                      />
                      <input
                        type="text"
                        placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s124', "الدور (اختياري)")}
                        value={paciFloor}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPaciFloor(val);
                          setNewAddress(buildPaciAddress({ floor: val }));
                        }}
                        style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
                      />
                      <input
                        type="text"
                        placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s125', "الشقة (اختياري)")}
                        value={paciApt}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPaciApt(val);
                          setNewAddress(buildPaciAddress({ apt: val }));
                        }}
                        style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={8}
                        placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s126', "الرقم الآلي (8 أرقام)")}
                        title={t('pos.pos_workspace.pos_phone_order_dialog.s127', "الرقم الآلي للعنوان المعتمد من PACI كويت فايندر")}
                        value={paciAutoNumber}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 8);
                          setPaciAutoNumber(val);
                          setNewAddress(buildPaciAddress({ autoNumber: val }));
                        }}
                        style={{ padding: '3px 6px', borderRadius: '4px', border: '1.5px solid #3b82f6', background: '#eff6ff', fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 700, color: '#1e40af' }}
                      />
                    </div>
                  </div>
                )}

                {/* Delivery Zone & Payment in New Customer Form */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: '#f8fafc', padding: '6px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div>
                    <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>
                      {t('pos.pos_workspace.pos_phone_order_dialog.s128', "منطقة التوصيل")}
                    </label>
                    <select
                      value={selectedZoneId}
                      onChange={(e) => handleZoneChange(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 6px',
                        borderRadius: '4px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.72rem',
                        background: '#ffffff',
                      }}
                    >
                      {deliveryZones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name} ({z.fee} {currencySym})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>
                      {t('pos.pos_workspace.pos_phone_order_dialog.s129', "طريقة الدفع عند الاستلام")}
                    </label>
                    <select
                      value={paymentMethodAtDoor}
                      onChange={(e) => setPaymentMethodAtDoor(e.target.value as DoorstepPaymentMethod)}
                      style={{
                        width: '100%',
                        padding: '4px 6px',
                        borderRadius: '4px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.72rem',
                        background: '#ffffff',
                      }}
                    >
                      <option value="cash">{t('pos.pos_workspace.pos_phone_order_dialog.s130', "كاش عند الاستلام")}</option>
                      <option value="card_pos">
                        {isKwd
                          ? t('pos.pos_workspace.pos_phone_order_dialog.s131', "كي نت مع المندوب (K-NET)")
                          : isKsa
                          ? t('pos.pos_workspace.pos_phone_order_dialog.s132', "مدى مع المندوب (mada POS)")
                          : t('pos.pos_workspace.pos_phone_order_dialog.s133', "فيزا مع الطيار (POS)")}
                      </option>
                      <option value="instapay_wallet">
                        {isKwd
                          ? t('pos.pos_workspace.pos_phone_order_dialog.s134', "رابط دفع أونلاين (K-NET Link)")
                          : isKsa
                          ? t('pos.pos_workspace.pos_phone_order_dialog.s135', "STC Pay / محفظة رقمية")
                          : t('pos.pos_workspace.pos_phone_order_dialog.s136', "إنستاباي / محفظة إلكترونية")}
                      </option>
                    </select>
                  </div>
                </div>

                <div>
                  <input
                    type="text"
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s137', "ملاحظات أو علامات مميزة للعنوان (مثال: أمام مسجد الفتح، مدخل العمارة من الجانب)...")}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.75rem',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '4px' }}>
                  <Button
                    type="submit"
                    disabled={createCustomerMutation.isPending}
                    size="sm"
                    style={{ background: '#170e5e', color: '#ffffff', fontWeight: 700, fontSize: '0.78rem' }}
                  >
                    <CheckCircleIcon size={14} style={{ marginLeft: '4px' }} />
                    {createCustomerMutation.isPending ? t('pos.pos_workspace.pos_phone_order_dialog.s138', "جاري الحفظ...") : t('pos.pos_workspace.pos_phone_order_dialog.s139', "حفظ العميل وبدء طلب التوصيل")}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </StandardDialog>
  );
}
