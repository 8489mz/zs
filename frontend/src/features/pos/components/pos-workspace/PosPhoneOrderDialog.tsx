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
  RefreshCwIcon,
  TrashIcon,
  UserIcon,
  ArrowLeftIcon,
} from '@/shared/components/icons/AppIcons';
import { getCurrencySymbol, isKuwait, isSaudi } from '@/lib/currencies';
import { PosPhoneOrderDialogTabs } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderDialogTabs';
import { PosPhoneOrderDialogFooter } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderDialogFooter';
import { PosPhoneOrderRecentCalls } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderRecentCalls';
import { PosPhoneOrderDialogHardware } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderDialogHardware';
import { PosPhoneOrderDialogSearchBar } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderDialogSearchBar';
import { PosPhoneOrderEmptyPrompt } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderEmptyPrompt';
import { PosPhoneOrderCustomerStrip } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderCustomerStrip';
import { PosPhoneOrderDialogProfileAddresses } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderDialogProfileAddresses';
import { PosPhoneOrderDelivery } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderDelivery';
import { PosPhoneOrderDialogOrdersLog } from '@/features/pos/components/pos-workspace/pos-phone-order/PosPhoneOrderDialogOrdersLog';

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
          <PosPhoneOrderDialogSearchBar
            searchInputRef={searchInputRef}
            phoneQuery={phoneQuery}
            setPhoneQuery={setPhoneQuery}
            setSelectedCustomerId={setSelectedCustomerId}
            setSelectedAddress={setSelectedAddress}
            setIsForceNewCustomer={setIsForceNewCustomer}
            setNewPhone={setNewPhone}
            isKwd={isKwd}
            isKsa={isKsa}
            deliveryLookupQuery={deliveryLookupQuery}
          />

          {/* Main Content Area */}
          {!currentCustomer && !isSearchActive ? (
            /* Empty prompt state */
            <PosPhoneOrderEmptyPrompt
              setActiveTab={setActiveTab}
              setIsForceNewCustomer={setIsForceNewCustomer}
              setNewPhone={setNewPhone}
              phoneQuery={phoneQuery}
            />
          ) : currentCustomer ? (
            /* STATE 1: Existing / Selected Customer Workspace */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Active Customer Strip */}
              <PosPhoneOrderCustomerStrip
                currentCustomer={currentCustomer}
                setSelectedCustomerId={setSelectedCustomerId}
                setSelectedAddress={setSelectedAddress}
                setIsForceNewCustomer={setIsForceNewCustomer}
                searchInputRef={searchInputRef}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: '10px' }}>
                {/* Left Column: Customer Profile, Addresses, Zone & Payment */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* Customer Quick Stats & Address Card */}
                  <PosPhoneOrderDialogProfileAddresses
                    profileData={profileData}
                    currentCustomer={currentCustomer}
                    setIsCustomAddressMode={setIsCustomAddressMode}
                    isCustomAddressMode={isCustomAddressMode}
                    setAddressTag={setAddressTag}
                    addressTag={addressTag}
                    customAddressInput={customAddressInput}
                    setCustomAddressInput={setCustomAddressInput}
                    handleSaveCustomAddress={handleSaveCustomAddress}
                    isKwd={isKwd}
                    addAddressMutation={addAddressMutation}
                    addresses={addresses}
                    selectedAddress={selectedAddress}
                    setSelectedAddress={setSelectedAddress}
                    deleteAddressMutation={deleteAddressMutation}
                  />

                  {/* Delivery Zone, Fees, Driver & Payment Setup */}
                  <PosPhoneOrderDelivery
                    selectedZoneId={selectedZoneId}
                    handleZoneChange={handleZoneChange}
                    deliveryZones={deliveryZones}
                    currencySym={currencySym}
                    selectedDriverId={selectedDriverId}
                    setSelectedDriverId={setSelectedDriverId}
                    deliveryReps={deliveryReps}
                    isKwd={isKwd}
                    customDeliveryFee={customDeliveryFee}
                    setCustomDeliveryFee={setCustomDeliveryFee}
                    setPaymentMethodAtDoor={setPaymentMethodAtDoor}
                    paymentMethodAtDoor={paymentMethodAtDoor}
                    isKsa={isKsa}
                    customerPaidNote={customerPaidNote}
                    setCustomerPaidNote={setCustomerPaidNote}
                    deliveryNotes={deliveryNotes}
                    setDeliveryNotes={setDeliveryNotes}
                  />
                </div>

                {/* Right Column: Order History & 1-Click Repeat */}
                <PosPhoneOrderDialogOrdersLog
                  recentOrders={recentOrders}
                  handleStartNewOrder={handleStartNewOrder}
                  handleReorder={handleReorder}
                />
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
