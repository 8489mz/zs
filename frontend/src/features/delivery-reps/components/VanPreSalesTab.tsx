import { useTranslation } from 'react-i18next';
import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { toast } from '@/shared/components/system-alert';
import {
  SearchIcon,
  PlusIcon,
  CheckCircleIcon,
  ClockIcon,
  RefreshCwIcon,
  XIcon,
  BuildingIcon,
  ArrowRightIcon,
  BoxesIcon,
  SlidersIcon,
} from '@/shared/components/icons/AppIcons';
import {
  vanSalesApi,
  PreSalesCatalogItem,
} from '../api/van-sales.api';
import { VanFloatingActionBar } from './VanFloatingActionBar';
import { VanInvoiceReviewModal } from './VanInvoiceReviewModal';
import { roundMoney } from '../utils/van-money.utils';

interface CustomerOption {
  id: number;
  name: string;
  phone?: string;
  balance: number;
  creditLimit?: number;
  customerCode?: string;
}

interface PreSalesCartLine {
  productId: number;
  productName: string;
  unitName: string;
  unitMultiplier: number;
  quantity: number; // Total base pieces
  cartons: number;
  pieces: number;
  packagingUnitName?: string;
  cartonMultiplier: number;
  pieceListPrice: number;
  cartonListPrice: number;
  pieceCashDiscount: number;
  cartonCashDiscount: number;
  pieceUnitPrice: number;
  cartonUnitPrice: number;
  unitPrice: number;
  consumerPrice?: number | null;
  pricingTierType: 'cash' | 'credit' | 'offer';
  unitOfferSavings?: number | null;
  warehouseAvailable: number;
}

interface VanPreSalesTabProps {
  customers: CustomerOption[];
  selectedCustomerId: number | '';
  onSelectCustomer: (val: number | '') => void;
  repId: number;
  repName?: string;
}

interface CompactStepperProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unitLabel: string;
  onIncrement: () => void;
  onDecrement: () => void;
  onChange: (val: number) => void;
  disabledIncrement?: boolean;
  disabledDecrement?: boolean;
  inputWidth?: string;
  height?: string;
}

/**
 * Strict RTL Stepper: [+] first in DOM (physically on the RIGHT), [-] last in DOM (physically on the LEFT).
 */
const CompactStepper: React.FC<CompactStepperProps> = ({
  value,
  min = 0,
  max = 999999,
  step = 1,
  unitLabel,
  onIncrement,
  onDecrement,
  onChange,
  disabledIncrement = false,
  disabledDecrement = false,
  inputWidth = '36px',
  height = '30px',
}) => {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          border: '1px solid #cbd5e1',
          borderRadius: '7px',
          backgroundColor: '#ffffff',
          overflow: 'hidden',
          height,
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        {/* STRICT RTL STEPPER: + is FIRST in DOM (Renders on the RIGHT) */}
        <button
          type="button"
          onClick={onIncrement}
          disabled={disabledIncrement}
          style={{
            width: '26px',
            height: '100%',
            border: 'none',
            backgroundColor: '#f8fafc',
            color: '#170e5e',
            cursor: disabledIncrement ? 'not-allowed' : 'pointer',
            opacity: disabledIncrement ? 0.35 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderInlineEnd: '1px solid #e2e8f0',
            fontWeight: 800,
            fontSize: '13px',
            padding: 0,
          }}
          title={`زيادة ${unitLabel}`}
        >
          +
        </button>

        <input
          type="number"
          step={step}
          className="no-spin-arrows"
          min={min}
          max={max}
          value={isNaN(value) ? '' : value}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            if (!isNaN(parsed)) onChange(Math.max(0, parsed));
            else if (e.target.value === '') onChange(0);
          }}
          onFocus={(e) => e.target.select()}
          style={{
            width: inputWidth,
            height: '100%',
            border: 'none',
            textAlign: 'center',
            fontSize: '12px',
            fontWeight: 800,
            color: '#0f172a',
            outline: 'none',
            MozAppearance: 'textfield',
            appearance: 'textfield',
            padding: '0 2px',
          }}
        />

        {/* STRICT RTL STEPPER: - is LAST in DOM (Renders on the LEFT) */}
        <button
          type="button"
          onClick={onDecrement}
          disabled={disabledDecrement}
          style={{
            width: '26px',
            height: '100%',
            border: 'none',
            backgroundColor: '#f8fafc',
            color: '#334155',
            cursor: disabledDecrement ? 'not-allowed' : 'pointer',
            opacity: disabledDecrement ? 0.35 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderInlineStart: '1px solid #e2e8f0',
            fontWeight: 800,
            fontSize: '14px',
            padding: 0,
          }}
          title={`إنقاص ${unitLabel}`}
        >
          -
        </button>
      </div>
      <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }}>
        {unitLabel}
      </span>
    </div>
  );
};

export const VanPreSalesTab: React.FC<VanPreSalesTabProps> = ({
  customers,
  selectedCustomerId,
  onSelectCustomer,
  repId: _repId,
  repName: _repName,
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [activeSubTab, setActiveSubTab] = useState<'new-booking' | 'my-orders'>('new-booking');
  const [paymentTerms, setPaymentTerms] = useState<'cash' | 'credit'>('cash');
  const [searchCatalogQuery, setSearchCatalogQuery] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [bookingNotes, setBookingNotes] = useState('');

  // Browsing by company and category
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [allCategoriesModalOpen, setAllCategoriesModalOpen] = useState(false);
  const [categoryModalSearch, setCategoryModalSearch] = useState('');
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);

  // Horizontal categories drag-to-scroll & mouse wheel ref
  const categoriesScrollRef = useRef<HTMLDivElement>(null);
  const isDraggingCatRef = useRef(false);
  const startXCatRef = useRef(0);
  const scrollLeftCatRef = useRef(0);

  const handleCatMouseDown = (e: React.MouseEvent) => {
    if (!categoriesScrollRef.current) return;
    isDraggingCatRef.current = true;
    startXCatRef.current = e.pageX - categoriesScrollRef.current.offsetLeft;
    scrollLeftCatRef.current = categoriesScrollRef.current.scrollLeft;
  };

  const handleCatMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingCatRef.current || !categoriesScrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - categoriesScrollRef.current.offsetLeft;
    const walk = (x - startXCatRef.current) * 1.5;
    categoriesScrollRef.current.scrollLeft = scrollLeftCatRef.current - walk;
  };

  const handleCatMouseUpOrLeave = () => {
    isDraggingCatRef.current = false;
  };

  // Cart
  const [cart, setCart] = useState<PreSalesCartLine[]>([]);

  // Fetch Warehouse Catalog
  const {
    data: catalogProducts = [],
    isLoading: isCatalogLoading,
  } = useQuery({
    queryKey: ['van-presales-warehouse-catalog', searchCatalogQuery],
    queryFn: () => vanSalesApi.fetchPreSalesCatalog({ search: searchCatalogQuery.trim() || undefined }),
    staleTime: 30_000,
  });

  // Fetch My Pre-Sales Orders
  const {
    data: myOrders = [],
    isLoading: isMyOrdersLoading,
    refetch: refetchMyOrders,
    isFetching: isMyOrdersFetching,
  } = useQuery({
    queryKey: ['van-presales-my-orders'],
    queryFn: () => vanSalesApi.fetchMyPreSalesOrders(),
    staleTime: 15_000,
  });

  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [hideOutOfStockCompanies, setHideOutOfStockCompanies] = useState(false);

  // Group products by Company (Supplier)
  const companies = useMemo(() => {
    const map = new Map<string, {
      name: string;
      totalProducts: number;
      availableProducts: number;
      categoryMap: Map<string, { id: number | null; name: string; count: number }>;
    }>();

    for (const prod of catalogProducts) {
      const compName = (prod.supplierName || '').trim() || 'الشركة العامة';
      if (!map.has(compName)) {
        map.set(compName, {
          name: compName,
          totalProducts: 0,
          availableProducts: 0,
          categoryMap: new Map(),
        });
      }
      const c = map.get(compName)!;
      c.totalProducts += 1;
      if (prod.warehouseAvailable > 0) {
        c.availableProducts += 1;
      }

      const catName = (prod.categoryName || '').trim() || 'عام';
      const catId = prod.categoryId ?? null;
      if (!c.categoryMap.has(catName)) {
        c.categoryMap.set(catName, { id: catId, name: catName, count: 0 });
      }
      c.categoryMap.get(catName)!.count += 1;
    }

    return Array.from(map.values())
      .map((c) => ({
        name: c.name,
        totalProducts: c.totalProducts,
        availableProducts: c.availableProducts,
        categories: Array.from(c.categoryMap.values()),
      }))
      .sort((a, b) => b.availableProducts - a.availableProducts);
  }, [catalogProducts]);

  // Filtered companies based on hideOutOfStockCompanies
  const displayedCompanies = useMemo(() => {
    if (!hideOutOfStockCompanies) return companies;
    return companies.filter((c) => c.availableProducts > 0);
  }, [companies, hideOutOfStockCompanies]);

  // Map of company name -> distinct items count in cart
  const cartCompanyCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cart) {
      const prod = catalogProducts.find((p) => p.id === item.productId);
      const comp = (prod?.supplierName || '').trim() || 'الشركة العامة';
      map.set(comp, (map.get(comp) || 0) + 1);
    }
    return map;
  }, [cart, catalogProducts]);

  // Categories for currently selected company
  const companyCategories = useMemo(() => {
    if (!selectedCompany) return [];
    if (selectedCompany === '__ALL__') {
      const catMap = new Map<string, { id: number | null; name: string; count: number }>();
      for (const p of catalogProducts) {
        const catName = (p.categoryName || '').trim() || 'عام';
        if (!catMap.has(catName)) {
          catMap.set(catName, { id: p.categoryId ?? null, name: catName, count: 0 });
        }
        catMap.get(catName)!.count += 1;
      }
      return Array.from(catMap.values());
    }
    const found = companies.find((c) => c.name === selectedCompany);
    return found ? found.categories : [];
  }, [companies, selectedCompany, catalogProducts]);

  // Filter Catalog
  const displayedProducts = useMemo(() => {
    return catalogProducts.filter((p) => {
      // Out of stock filter
      if (!showOutOfStock && p.warehouseAvailable <= 0) return false;

      // If user typed in search bar: search takes priority
      if (searchCatalogQuery.trim()) {
        const q = searchCatalogQuery.toLowerCase().trim();
        const matchName = (p.name || '').toLowerCase().includes(q);
        const matchBarcode = (p.barcode || '').toLowerCase().includes(q);
        const matchCompany = (p.supplierName || '').toLowerCase().includes(q);
        return matchName || matchBarcode || matchCompany;
      }

      // If user is inside a company: filter by company & category
      if (selectedCompany) {
        if (selectedCompany !== '__ALL__') {
          const compName = (p.supplierName || '').trim() || 'الشركة العامة';
          if (compName !== selectedCompany) return false;
        }

        if (selectedCategory !== 'all') {
          const catName = (p.categoryName || '').trim() || 'عام';
          if (catName !== selectedCategory) return false;
        }
        return true;
      }

      return true;
    });
  }, [catalogProducts, searchCatalogQuery, selectedCompany, selectedCategory, showOutOfStock]);

  const availableItemsCount = useMemo(() => {
    return catalogProducts.filter((p) => p.warehouseAvailable > 0).length;
  }, [catalogProducts]);

  const outOfStockCount = useMemo(() => {
    return catalogProducts.length - availableItemsCount;
  }, [catalogProducts, availableItemsCount]);

  // Selected customer object
  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customers.find((c) => Number(c.id) === Number(selectedCustomerId)) || null;
  }, [customers, selectedCustomerId]);

  // Compute pricing for an item based on terms and quantity
  // Official baseline is Credit Price; when selling Cash, difference is "خصم تعجيل دفع (سداد نقدي)"
  const calculateItemPrice = (
    item: PreSalesCatalogItem,
    terms: 'cash' | 'credit',
    totalBaseQty: number,
    multiplier: number,
  ) => {
    const isCredit = terms === 'credit';
    const creditBasePrice =
      item.creditPrice != null && Number(item.creditPrice) > 0
        ? Number(item.creditPrice) * multiplier
        : Number(item.retailPrice || 0) * multiplier;

    const cashBasePrice = Number(item.retailPrice || 0) * multiplier;
    // Official baseline list price:
    const listPrice = Math.max(creditBasePrice, cashBasePrice);

    // Cash discount per unit is the difference between list/credit price and cash price
    const cashDiscountPerUnit = isCredit ? 0 : Math.max(0, roundMoney(listPrice - cashBasePrice));

    let effectivePrice = isCredit ? listPrice : cashBasePrice;
    let tierType: 'cash' | 'credit' | 'offer' = isCredit ? 'credit' : 'cash';
    let savings = cashDiscountPerUnit;

    // Check offers (offers lower effective price further)
    const matchingOffer = (item.offers || [])
      .filter((off) => totalBaseQty >= Math.max(1, Number(off.minQty || 1)))
      .sort((a, b) => Number(b.minQty || 0) - Number(a.minQty || 0))[0];

    if (matchingOffer) {
      const offerVal = Number(matchingOffer.value || 0);
      if (matchingOffer.offerType === 'percent' && offerVal > 0) {
        effectivePrice = Math.max(0, roundMoney(effectivePrice * (1 - offerVal / 100)));
        tierType = 'offer';
        savings = Math.max(0, roundMoney(listPrice - effectivePrice));
      } else if (matchingOffer.offerType === 'fixed' && offerVal > 0) {
        effectivePrice = Math.max(0, roundMoney(effectivePrice - offerVal * multiplier));
        tierType = 'offer';
        savings = Math.max(0, roundMoney(listPrice - effectivePrice));
      } else if (matchingOffer.offerType === 'price' && offerVal > 0) {
        effectivePrice = roundMoney(offerVal * multiplier);
        tierType = 'offer';
        savings = Math.max(0, roundMoney(listPrice - effectivePrice));
      }
    }

    const consumerPrice =
      item.consumerPrice != null && Number(item.consumerPrice) > 0
        ? roundMoney(Number(item.consumerPrice) * multiplier)
        : null;

    return { listPrice, cashDiscountPerUnit, effectivePrice, tierType, savings, consumerPrice };
  };

  // Update Carton and Piece Quantities for an item
  const handleUpdateProductUnits = (
    product: PreSalesCatalogItem,
    targetCartons: number,
    targetPieces: number,
  ) => {
    const mult = product.packagingUnit?.multiplier || 1;
    const isCartonItem = Boolean(product.packagingUnit && mult > 1);
    const safeCartons = isCartonItem ? Math.max(0, targetCartons) : 0;
    const safePieces = Math.max(0, targetPieces);
    const totalBaseQty = safeCartons * mult + safePieces;

    if (totalBaseQty > product.warehouseAvailable) {
      toast.warning(`أقصى رصيد متاح للحجز من "${product.name}" بالمخزن هو ${product.warehouseAvailable} قطعة`);
      return;
    }

    setCart((prev) => {
      const existingIdx = prev.findIndex((l) => l.productId === product.id);

      if (totalBaseQty <= 0) {
        if (existingIdx >= 0) {
          return prev.filter((l) => l.productId !== product.id);
        }
        return prev;
      }

      const piecePricing = calculateItemPrice(product, paymentTerms, totalBaseQty, 1);
      const cartonPricing = isCartonItem ? calculateItemPrice(product, paymentTerms, totalBaseQty, mult) : null;

      const newCartLine: PreSalesCartLine = {
        productId: product.id,
        productName: product.name,
        unitName: isCartonItem ? (safeCartons > 0 ? (product.packagingUnit?.name || 'كرتونة') : 'قطعة') : 'قطعة',
        unitMultiplier: mult,
        quantity: totalBaseQty,
        cartons: safeCartons,
        pieces: safePieces,
        packagingUnitName: product.packagingUnit?.name || 'كرتونة',
        cartonMultiplier: mult,
        pieceListPrice: piecePricing.listPrice,
        cartonListPrice: cartonPricing ? cartonPricing.listPrice : piecePricing.listPrice * mult,
        pieceCashDiscount: piecePricing.cashDiscountPerUnit,
        cartonCashDiscount: cartonPricing ? cartonPricing.cashDiscountPerUnit : piecePricing.cashDiscountPerUnit * mult,
        pieceUnitPrice: piecePricing.effectivePrice,
        cartonUnitPrice: cartonPricing ? cartonPricing.effectivePrice : piecePricing.effectivePrice * mult,
        unitPrice: piecePricing.effectivePrice,
        consumerPrice: piecePricing.consumerPrice,
        pricingTierType: piecePricing.tierType,
        unitOfferSavings: piecePricing.savings,
        warehouseAvailable: product.warehouseAvailable,
      };

      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = newCartLine;
        return next;
      } else {
        return [...prev, newCartLine];
      }
    });
  };

  // Quick increment/decrement from Cart
  const handleCartDelta = (productId: number, unitType: 'carton' | 'piece', delta: number) => {
    const line = cart.find((l) => l.productId === productId);
    if (!line) return;
    const prod = catalogProducts.find((p) => p.id === productId);
    if (!prod) return;

    if (unitType === 'carton') {
      handleUpdateProductUnits(prod, line.cartons + delta, line.pieces);
    } else {
      handleUpdateProductUnits(prod, line.cartons, line.pieces + delta);
    }
  };

  // Change payment terms (Cash / Credit) & refresh cart prices immediately
  const handlePaymentTermsChange = (newTerms: 'cash' | 'credit') => {
    setPaymentTerms(newTerms);
    setCart((prev) =>
      prev.map((line) => {
        const catItem = catalogProducts.find((p) => p.id === line.productId);
        if (!catItem) return line;
        const totalBase = line.quantity;
        const piecePricing = calculateItemPrice(catItem, newTerms, totalBase, 1);
        const cartonPricing = line.cartonMultiplier > 1 ? calculateItemPrice(catItem, newTerms, totalBase, line.cartonMultiplier) : null;
        return {
          ...line,
          pieceListPrice: piecePricing.listPrice,
          cartonListPrice: cartonPricing ? cartonPricing.listPrice : piecePricing.listPrice * line.cartonMultiplier,
          pieceCashDiscount: piecePricing.cashDiscountPerUnit,
          cartonCashDiscount: cartonPricing ? cartonPricing.cashDiscountPerUnit : piecePricing.cashDiscountPerUnit * line.cartonMultiplier,
          pieceUnitPrice: piecePricing.effectivePrice,
          cartonUnitPrice: cartonPricing ? cartonPricing.effectivePrice : piecePricing.effectivePrice * line.cartonMultiplier,
          unitPrice: piecePricing.effectivePrice,
          pricingTierType: piecePricing.tierType,
          unitOfferSavings: piecePricing.savings,
        };
      }),
    );
  };

  // Cart totals: Gross (Credit), Cash Discount, and Net Payable
  const cartGrossSubtotal = useMemo(() => {
    return cart.reduce((sum, line) => {
      if (line.cartonMultiplier > 1 && (line.cartons > 0 || line.pieces > 0)) {
        return sum + (line.cartons * line.cartonListPrice + line.pieces * line.pieceListPrice);
      }
      return sum + line.quantity * line.pieceListPrice;
    }, 0);
  }, [cart]);

  const cartNetTotal = useMemo(() => {
    return cart.reduce((sum, line) => {
      if (line.cartonMultiplier > 1 && (line.cartons > 0 || line.pieces > 0)) {
        return sum + (line.cartons * line.cartonUnitPrice + line.pieces * line.pieceUnitPrice);
      }
      return sum + line.quantity * line.pieceUnitPrice;
    }, 0);
  }, [cart]);

  const cartDiscountAmount = useMemo(() => {
    return Math.max(0, roundMoney(cartGrossSubtotal - cartNetTotal));
  }, [cartGrossSubtotal, cartNetTotal]);

  const totalPieces = useMemo(() => {
    return cart.reduce((sum, line) => sum + line.quantity, 0);
  }, [cart]);

  // Submit Pre-Sales Booking Mutation
  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCustomerId) {
        throw new Error('يرجى اختيار العميل المطلوب حجز الطلبية له أولاً');
      }
      if (cart.length === 0) {
        throw new Error('سلة الحجز فارغة. أضف أصنافاً أولاً');
      }

      const itemsPayload: Array<{
        productId: number;
        qty: number;
        quantity: number;
        unitName: string;
        unitMultiplier: number;
        unitPrice: number;
      }> = [];

      for (const line of cart) {
        if (line.cartonMultiplier > 1) {
          if (line.cartons > 0) {
            itemsPayload.push({
              productId: line.productId,
              qty: line.cartons,
              quantity: line.cartons,
              unitName: line.packagingUnitName || 'كرتونة',
              unitMultiplier: line.cartonMultiplier,
              unitPrice: line.cartonUnitPrice,
            });
          }
          if (line.pieces > 0) {
            itemsPayload.push({
              productId: line.productId,
              qty: line.pieces,
              quantity: line.pieces,
              unitName: 'قطعة',
              unitMultiplier: 1,
              unitPrice: line.pieceUnitPrice,
            });
          }
        } else {
          itemsPayload.push({
            productId: line.productId,
            qty: line.quantity,
            quantity: line.quantity,
            unitName: line.unitName || 'قطعة',
            unitMultiplier: 1,
            unitPrice: line.pieceUnitPrice,
          });
        }
      }

      return vanSalesApi.createPreSalesOrder({
        customerId: Number(selectedCustomerId),
        paymentMethod: paymentTerms,
        notes: bookingNotes.trim() || undefined,
        deliveryDate: deliveryDate || undefined,
        items: itemsPayload,
      });
    },
    onSuccess: (res) => {
      toast.success(`تم حجز الطلبية رقم #${res.orderNumber} بالمخزن الرئيسي وإرسالها للمشرف للاعتماد!`);
      setCart([]);
      setBookingNotes('');
      setDeliveryDate('');
      setActiveSubTab('my-orders');
      queryClient.invalidateQueries({ queryKey: ['van-presales-warehouse-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['van-presales-my-orders'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر تسجيل وحجز طلبية المندوب');
    },
  });

  const handleConfirmOrder = () => {
    if (!selectedCustomerId) {
      toast.warning('يرجى اختيار العميل المطلوب حجز الطلبية له أولاً');
      const cartSelect = document.getElementById('cart-customer-select');
      if (cartSelect) {
        cartSelect.focus();
        cartSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    if (cart.length === 0) {
      toast.warning('سلة الحجز فارغة. أضف أصنافاً أولاً');
      return;
    }

    // Open pre-confirmation review modal first
    setIsReviewModalOpen(true);
  };

  const getOrderStatusBadge = (status: string) => {
    switch (status) {
      case 'pending_supervisor':
      case 'pending_approval':
        return (
          <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, backgroundColor: '#fef3c7', color: '#b45309' }}>
            {t('delivery_reps.van_pre_sales_tab.s0', "بانتظار اعتماد المشرف")}
          </span>
        );
      case 'approved':
      case 'confirmed':
        return (
          <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, backgroundColor: '#dcfce7', color: '#15803d' }}>
            {t('delivery_reps.van_pre_sales_tab.s1', "معتمدة وجاهزة للتحميل")}
          </span>
        );
      case 'rejected':
        return (
          <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, backgroundColor: '#fee2e2', color: '#b91c1c' }}>
            {t('delivery_reps.van_pre_sales_tab.s2', "مرفوضة من المشرف")}
          </span>
        );
      default:
        return (
          <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, backgroundColor: '#f1f5f9', color: '#475569' }}>
            {status}
          </span>
        );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '24px' }}>
      {/* SUB-TABS SELECTOR */}
      <div
        style={{
          display: 'flex',
          backgroundColor: '#f1f5f9',
          padding: '3px',
          borderRadius: '10px',
          gap: '4px',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveSubTab('new-booking')}
          style={{
            flex: 1,
            padding: '8px 4px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 600,
            border: activeSubTab === 'new-booking' ? '1px solid #170e5e' : '1px solid transparent',
            background: activeSubTab === 'new-booking' ? '#170e5e' : 'transparent',
            color: activeSubTab === 'new-booking' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <PlusIcon size={14} />
          <span>{t('delivery_reps.van_pre_sales_tab.s3', "حجز طلبية جديدة من المخزن")}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('my-orders')}
          style={{
            flex: 1,
            padding: '8px 4px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 600,
            border: activeSubTab === 'my-orders' ? '1px solid #170e5e' : '1px solid transparent',
            background: activeSubTab === 'my-orders' ? '#170e5e' : 'transparent',
            color: activeSubTab === 'my-orders' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <ClockIcon size={14} />
          <span>{t('delivery_reps.van_pre_sales_tab.s4', "طلبياتي المحجوزة (")}{myOrders.length})</span>
        </button>
      </div>

      {activeSubTab === 'new-booking' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* CUSTOMER & PAYMENT TERMS CARD */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              padding: '12px 14px',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{t('delivery_reps.van_pre_sales_tab.s5', "العميل وطريقة الدفع:")}</span>
              <div style={{ display: 'flex', gap: '5px' }}>
                <button
                  type="button"
                  onClick={() => handlePaymentTermsChange('cash')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '7px',
                    fontSize: '11.5px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    border: paymentTerms === 'cash' ? '1.5px solid #059669' : '1px solid #cbd5e1',
                    backgroundColor: paymentTerms === 'cash' ? '#ecfdf5' : '#ffffff',
                    color: paymentTerms === 'cash' ? '#065f46' : '#64748b',
                    boxShadow: paymentTerms === 'cash' ? '0 1px 3px rgba(5,150,105,0.12)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {t('delivery_reps.van_pre_sales_tab.s6', "كاش نقدي")}
                </button>
                <button
                  type="button"
                  onClick={() => handlePaymentTermsChange('credit')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '7px',
                    fontSize: '11.5px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    border: paymentTerms === 'credit' ? '1.5px solid #d97706' : '1px solid #cbd5e1',
                    backgroundColor: paymentTerms === 'credit' ? '#fffbeb' : '#ffffff',
                    color: paymentTerms === 'credit' ? '#92400e' : '#64748b',
                    boxShadow: paymentTerms === 'credit' ? '0 1px 3px rgba(217,119,6,0.12)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {t('delivery_reps.van_pre_sales_tab.s7', "آجل على الحساب")}
                </button>
              </div>
            </div>

            <select
              value={selectedCustomerId}
              onChange={(e) => onSelectCustomer(e.target.value ? Number(e.target.value) : '')}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 10px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '12.5px',
                color: '#0f172a',
                boxSizing: 'border-box',
              }}
            >
              <option value="">{t('delivery_reps.van_pre_sales_tab.s8', "-- اختر العميل لتسجيل الطلبية --")}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone ? `(${c.phone})` : ''} {t('delivery_reps.van_pre_sales_tab.s9', "- رصيد:")} {Number(c.balance || 0).toFixed(0)}
                </option>
              ))}
            </select>

            {selectedCustomer && (
              <div
                style={{
                  fontSize: '11.5px',
                  backgroundColor: '#f8fafc',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  border: '1px solid #e2e8f0',
                }}
              >
                <span>
                  {t('delivery_reps.van_pre_sales_tab.s10', "الرصيد الحالي:")} <strong style={{ color: Number(selectedCustomer.balance) > 0 ? '#b91c1c' : Number(selectedCustomer.balance) < 0 ? '#0369a1' : '#475569' }}>{Number(selectedCustomer.balance || 0) === 0 ? t('delivery_reps.van_pre_sales_tab.s11', "خالص (0.00)") : Number(selectedCustomer.balance).toFixed(2)} <CurrencySymbol /></strong>
                </span>
                <span>
                  {t('delivery_reps.van_pre_sales_tab.s12', "سقف الائتمان:")} <strong style={{ color: '#170e5e' }}>{selectedCustomer.creditLimit ? `${Number(selectedCustomer.creditLimit).toFixed(2)}` : t('delivery_reps.van_pre_sales_tab.s13', "غير محدد")}</strong>
                </span>
              </div>
            )}
          </div>

          {/* CATALOG SEARCH BAR */}
          <div style={{ position: 'relative', width: '100%' }}>
            <input
              type="text"
              placeholder={t('delivery_reps.van_pre_sales_tab.s14', "ابحث بالاسم أو الباركود في المخزن الرئيسي...")}
              value={searchCatalogQuery}
              onChange={(e) => setSearchCatalogQuery(e.target.value)}
              style={{
                width: '100%',
                height: '38px',
                padding: searchCatalogQuery ? '0 32px 0 32px' : '0 32px 0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '12.5px',
                boxSizing: 'border-box',
                backgroundColor: '#ffffff',
                outline: 'none',
              }}
            />
            <SearchIcon
              size={15}
              color="#94a3b8"
              style={{
                position: 'absolute',
                right: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
              }}
            />
            {searchCatalogQuery && (
              <button
                type="button"
                onClick={() => setSearchCatalogQuery('')}
                style={{
                  position: 'absolute',
                  left: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: '50%',
                  width: '22px',
                  height: '22px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#64748b',
                  padding: 0,
                }}
                title={t('delivery_reps.van_pre_sales_tab.s15', "مسح البحث")}
              >
                <XIcon size={13} />
              </button>
            )}
          </div>

          {/* COMPANY / CATALOG WORKFLOW */}
          {searchCatalogQuery.trim() ? (
            /* SEARCH RESULTS VIEW */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px', fontSize: '11.5px' }}>
                <span style={{ color: '#475569', fontWeight: 700 }}>
                  {t('delivery_reps.van_pre_sales_tab.s16', "نتائج البحث: (")}{displayedProducts.length} {t('delivery_reps.van_pre_sales_tab.s17', "صنف)")}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {outOfStockCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowOutOfStock((prev) => !prev)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: showOutOfStock ? '#170e5e' : '#64748b',
                        fontWeight: 700,
                        fontSize: '11px',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0,
                      }}
                    >
                      {showOutOfStock ? t('delivery_reps.van_pre_sales_tab.s18', "إخفاء غير المتوفر") : `غير المتوفر (${outOfStockCount})`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSearchCatalogQuery('')}
                    style={{ background: 'none', border: 'none', color: '#170e5e', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  >
                    {t('delivery_reps.van_pre_sales_tab.s19', "العودة لتصفح الشركات")}
                  </button>
                </div>
              </div>

              {renderProductsList(displayedProducts)}
            </div>
          ) : !selectedCompany ? (
            /* COMPANIES GRID VIEW (DEFAULT) */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                  <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                    {t('delivery_reps.van_pre_sales_tab.s20', "شركات وموردي البضاعة (")}{companies.length})
                  </span>
                </div>
                {companies.some((c) => c.availableProducts === 0) && (
                  <button
                    type="button"
                    onClick={() => setHideOutOfStockCompanies((prev) => !prev)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: hideOutOfStockCompanies ? '#170e5e' : '#64748b',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {hideOutOfStockCompanies ? t('delivery_reps.van_pre_sales_tab.s21', "عرض كل الشركات") : t('delivery_reps.van_pre_sales_tab.s22', "المتوفر فقط")}
                  </button>
                )}
              </div>

              {displayedCompanies.length === 0 ? (
                <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                  {t('delivery_reps.van_pre_sales_tab.s23', "لا توجد شركات مطابقة بالمخزن حالياً")}
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: '8px',
                  }}
                >
                  {/* ALL PRODUCTS MASTER CARD */}
                  <div
                    onClick={() => {
                      setSelectedCompany('__ALL__');
                      setSelectedCategory('all');
                    }}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1.5px solid #170e5e',
                      borderRadius: '12px',
                      padding: '9px 8px',
                      cursor: 'pointer',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                      boxShadow: '0 1px 3px rgba(23,14,94,0.06)',
                    }}
                  >
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '9px',
                        backgroundColor: '#170e5e',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ffffff',
                      }}
                    >
                      <BoxesIcon size={16} />
                    </div>

                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: '11.5px',
                        color: '#170e5e',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={t('delivery_reps.van_pre_sales_tab.s24', "كافة أصناف المخزن")}
                    >
                      {t('delivery_reps.van_pre_sales_tab.s25', "كافة الأصناف")}
                    </span>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: availableItemsCount > 0 ? '#047857' : '#94a3b8',
                          backgroundColor: availableItemsCount > 0 ? '#ecfdf5' : '#f1f5f9',
                          border: `1px solid ${availableItemsCount > 0 ? '#a7f3d0' : '#e2e8f0'}`,
                          padding: '1px 7px',
                          borderRadius: '10px',
                        }}
                      >
                        {availableItemsCount > 0 ? `${availableItemsCount} صنف متاح` : `${catalogProducts.length} صنف`}
                      </span>
                      {cart.length > 0 && (
                        <span
                          style={{
                            fontSize: '9.5px',
                            fontWeight: 800,
                            color: '#170e5e',
                            backgroundColor: '#e0e7ff',
                            border: '1px solid #c7d2fe',
                            padding: '1px 5px',
                            borderRadius: '10px',
                          }}
                        >
                          {cart.length} {t('delivery_reps.van_pre_sales_tab.s26', "بالسلة")}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* INDIVIDUAL COMPANY CARDS */}
                  {displayedCompanies.map((comp) => {
                    const inCartCount = cartCompanyCounts.get(comp.name) || 0;
                    return (
                      <div
                        key={comp.name}
                        onClick={() => {
                          setSelectedCompany(comp.name);
                          setSelectedCategory('all');
                        }}
                        style={{
                          backgroundColor: inCartCount > 0 ? '#fbfbfe' : '#ffffff',
                          border: inCartCount > 0 ? '1.5px solid #a5b4fc' : '1px solid #e2e8f0',
                          borderRadius: '12px',
                          padding: '9px 8px',
                          cursor: 'pointer',
                          textAlign: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '4px',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                        }}
                      >
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '9px',
                            backgroundColor: '#eef2ff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#170e5e',
                          }}
                        >
                          <BuildingIcon size={16} />
                        </div>

                        <span
                          style={{
                            fontWeight: 800,
                            fontSize: '11.5px',
                            color: '#0f172a',
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={comp.name}
                        >
                          {comp.name}
                        </span>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              color: comp.availableProducts > 0 ? '#047857' : '#94a3b8',
                              backgroundColor: comp.availableProducts > 0 ? '#ecfdf5' : '#f1f5f9',
                              border: `1px solid ${comp.availableProducts > 0 ? '#a7f3d0' : '#e2e8f0'}`,
                              padding: '1px 7px',
                              borderRadius: '10px',
                            }}
                          >
                            {comp.availableProducts > 0 ? `${comp.availableProducts} صنف متاح` : t('delivery_reps.van_pre_sales_tab.s27', "نفد الرصيد")}
                          </span>
                          {inCartCount > 0 && (
                            <span
                              style={{
                                fontSize: '9.5px',
                                fontWeight: 800,
                                color: '#170e5e',
                                backgroundColor: '#e0e7ff',
                                border: '1px solid #c7d2fe',
                                padding: '1px 5px',
                                borderRadius: '10px',
                              }}
                            >
                              {inCartCount} {t('delivery_reps.van_pre_sales_tab.s28', "بالسلة")}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* SELECTED COMPANY VIEW: HORIZONTAL CATEGORIES BAR & PRODUCTS */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* COMPANY HEADER WITH BACK BUTTON */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                  padding: '7px 10px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCompany(null);
                      setSelectedCategory('all');
                    }}
                    style={{
                      height: '28px',
                      padding: '0 8px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      backgroundColor: '#f8fafc',
                      color: '#170e5e',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                    title={t('delivery_reps.van_pre_sales_tab.s29', "الرجوع لقائمة الشركات")}
                  >
                    <ArrowRightIcon size={13} />
                    <span>{t('delivery_reps.van_pre_sales_tab.s30', "الشركات")}</span>
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: '12.5px',
                        fontWeight: 800,
                        color: '#0f172a',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={selectedCompany === '__ALL__' ? t('delivery_reps.van_pre_sales_tab.s31', "كافة أصناف المخزن") : selectedCompany || ''}
                    >
                      {selectedCompany === '__ALL__' ? t('delivery_reps.van_pre_sales_tab.s32', "كافة أصناف المخزن") : selectedCompany}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        color: '#170e5e',
                        fontWeight: 700,
                        backgroundColor: '#eef2ff',
                        padding: '1px 6px',
                        borderRadius: '8px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {displayedProducts.length} {t('delivery_reps.van_pre_sales_tab.s33', "صنف")}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  {outOfStockCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowOutOfStock((prev) => !prev)}
                      style={{
                        height: '26px',
                        padding: '0 8px',
                        borderRadius: '6px',
                        border: showOutOfStock ? '1px solid #c7d2fe' : '1px solid #e2e8f0',
                        backgroundColor: showOutOfStock ? '#e0e7ff' : '#f8fafc',
                        color: showOutOfStock ? '#170e5e' : '#64748b',
                        fontWeight: 700,
                        fontSize: '10.5px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                    >
                      {showOutOfStock ? t('delivery_reps.van_pre_sales_tab.s34', "إخفاء غير المتوفر") : `غير المتوفر (${outOfStockCount})`}
                    </button>
                  )}
                </div>
              </div>

              {/* HORIZONTAL CATEGORIES BAR - HYBRID SWIPEABLE & MODAL ACCESS */}
              <div
                ref={categoriesScrollRef}
                onMouseDown={handleCatMouseDown}
                onMouseMove={handleCatMouseMove}
                onMouseUp={handleCatMouseUpOrLeave}
                onMouseLeave={handleCatMouseUpOrLeave}
                onWheel={(e) => {
                  if (e.deltaY !== 0 && categoriesScrollRef.current) {
                    categoriesScrollRef.current.scrollLeft += e.deltaY;
                  }
                }}
                style={{
                  display: 'flex',
                  gap: '6px',
                  overflowX: 'auto',
                  padding: '2px 0 6px',
                  scrollbarWidth: 'none',
                  WebkitOverflowScrolling: 'touch',
                  cursor: isDraggingCatRef.current ? 'grabbing' : 'grab',
                  userSelect: 'none',
                }}
              >
                {/* 1. All Categories Button */}
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  style={{
                    height: '28px',
                    padding: '0 10px',
                    borderRadius: '14px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    border: selectedCategory === 'all' ? '1px solid #170e5e' : '1px solid #cbd5e1',
                    backgroundColor: selectedCategory === 'all' ? '#170e5e' : '#ffffff',
                    color: selectedCategory === 'all' ? '#ffffff' : '#475569',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    flexShrink: 0,
                  }}
                >
                  <span>{t('delivery_reps.van_pre_sales_tab.s35', "الكل")}</span>
                  <span style={{ opacity: selectedCategory === 'all' ? 0.9 : 0.7, fontSize: '10px' }}>
                    ({selectedCompany === '__ALL__' ? catalogProducts.length : catalogProducts.filter((p) => ((p.supplierName || '').trim() || t('delivery_reps.van_pre_sales_tab.s36', "الشركة العامة")) === selectedCompany).length})
                  </span>
                </button>

                {/* 2. Show All Categories Modal Trigger Button */}
                {companyCategories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryModalSearch('');
                      setAllCategoriesModalOpen(true);
                    }}
                    style={{
                      height: '28px',
                      padding: '0 10px',
                      borderRadius: '14px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      border: '1px solid #c7d2fe',
                      backgroundColor: '#eef2ff',
                      color: '#170e5e',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      flexShrink: 0,
                    }}
                    title={t('delivery_reps.van_pre_sales_tab.s37', "فتح نافذة تصفح كافة الأقسام")}
                  >
                    <SlidersIcon size={12} color="#170e5e" />
                    <span>{t('delivery_reps.van_pre_sales_tab.s38', "كافة الأقسام (")}{companyCategories.length})</span>
                  </button>
                )}

                {/* 3. Horizontal Category Pills */}
                {companyCategories.map((cat) => (
                  <button
                    key={cat.name}
                    type="button"
                    onClick={() => setSelectedCategory(cat.name)}
                    style={{
                      height: '28px',
                      padding: '0 10px',
                      borderRadius: '14px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      border: selectedCategory === cat.name ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      backgroundColor: selectedCategory === cat.name ? '#170e5e' : '#ffffff',
                      color: selectedCategory === cat.name ? '#ffffff' : '#475569',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      flexShrink: 0,
                    }}
                  >
                    <bdi>{cat.name}</bdi>
                    <span style={{ opacity: selectedCategory === cat.name ? 0.9 : 0.7, fontSize: '10px' }}>
                      ({cat.count})
                    </span>
                  </button>
                ))}
              </div>

              {/* PRODUCTS LIST */}
              {renderProductsList(displayedProducts)}
            </div>
          )}

          {/* BOOKING CART & STEPPERS (Visible when cart has items) */}
          {cart.length > 0 && (
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
              }}
            >
              {/* Cart Header with Quick Payment Terms Switcher */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                  {t('delivery_reps.van_pre_sales_tab.s39', "بنود الحجز (")}{cart.length} {t('delivery_reps.van_pre_sales_tab.s40', "أصناف |")} {totalPieces} {t('delivery_reps.van_pre_sales_tab.s41', "قطعة):")}
                </span>

                <div style={{ display: 'inline-flex', backgroundColor: '#f1f5f9', borderRadius: '7px', padding: '2px', border: '1px solid #cbd5e1' }}>
                  <button
                    type="button"
                    onClick={() => handlePaymentTermsChange('cash')}
                    style={{
                      padding: '3px 9px',
                      borderRadius: '5px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: 'none',
                      backgroundColor: paymentTerms === 'cash' ? '#15803d' : 'transparent',
                      color: paymentTerms === 'cash' ? '#ffffff' : '#64748b',
                    }}
                  >
                    {t('delivery_reps.van_pre_sales_tab.s42', "كاش نقدي")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePaymentTermsChange('credit')}
                    style={{
                      padding: '3px 9px',
                      borderRadius: '5px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: 'none',
                      backgroundColor: paymentTerms === 'credit' ? '#b45309' : 'transparent',
                      color: paymentTerms === 'credit' ? '#ffffff' : '#64748b',
                    }}
                  >
                    {t('delivery_reps.van_pre_sales_tab.s43', "آجل على الحساب")}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {cart.map((line) => {
                  const lineNetTotal = line.cartonMultiplier > 1 && (line.cartons > 0 || line.pieces > 0)
                    ? line.cartons * line.cartonUnitPrice + line.pieces * line.pieceUnitPrice
                    : line.quantity * line.pieceUnitPrice;

                  const lineGrossTotal = line.cartonMultiplier > 1 && (line.cartons > 0 || line.pieces > 0)
                    ? line.cartons * line.cartonListPrice + line.pieces * line.pieceListPrice
                    : line.quantity * line.pieceListPrice;

                  const lineCashDiscount = Math.max(0, roundMoney(lineGrossTotal - lineNetTotal));

                  return (
                    <div
                      key={line.productId}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        paddingBottom: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '12.5px', color: '#0f172a' }}>{line.productName}</div>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            {line.cartonMultiplier > 1 ? (
                              <span>
                                {line.cartons > 0 ? `${line.cartons} ${line.packagingUnitName || t('delivery_reps.van_pre_sales_tab.s44', "كرتونة")}` : ''}
                                {line.cartons > 0 && line.pieces > 0 ? ' + ' : ''}
                                {line.pieces > 0 ? `${line.pieces} قطعة` : ''}
                                {' '}{t('delivery_reps.van_pre_sales_tab.s45', "(إجمالي:")} {line.quantity} {t('delivery_reps.van_pre_sales_tab.s46', "قطعة)")}
                              </span>
                            ) : (
                              <span>{line.quantity} {t('delivery_reps.van_pre_sales_tab.s47', "قطعة")}</span>
                            )}

                            {paymentTerms === 'cash' && lineCashDiscount > 0 && (
                              <span
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  color: '#059669',
                                  backgroundColor: '#dcfce7',
                                  border: '1px solid #86efac',
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {t('delivery_reps.van_pre_sales_tab.s48', "خصم تعجيل دفع: -")}{lineCashDiscount.toFixed(2)} <CurrencySymbol />
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ textAlign: 'left', flexShrink: 0 }}>
                          {paymentTerms === 'cash' && lineCashDiscount > 0 && (
                            <div style={{ fontSize: '10.5px', color: '#94a3b8', textDecoration: 'line-through', lineHeight: 1.2 }}>
                              {lineGrossTotal.toFixed(2)}
                            </div>
                          )}
                          <span style={{ fontWeight: 800, fontSize: '12.5px', color: '#170e5e' }}>
                            {lineNetTotal.toFixed(2)} <CurrencySymbol />
                          </span>
                        </div>
                      </div>

                      {/* QUICK CONTROLS IN CART */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', alignItems: 'center' }}>
                        {line.cartonMultiplier > 1 ? (
                          <>
                            <CompactStepper
                              value={line.cartons}
                              unitLabel={line.packagingUnitName || t('delivery_reps.van_pre_sales_tab.s49', "كرتونة")}
                              onIncrement={() => handleCartDelta(line.productId, 'carton', 1)}
                              onDecrement={() => handleCartDelta(line.productId, 'carton', -1)}
                              onChange={(val) => {
                                const prod = catalogProducts.find((p) => p.id === line.productId);
                                if (prod) handleUpdateProductUnits(prod, val, line.pieces);
                              }}
                              disabledDecrement={line.cartons <= 0}
                              height="28px"
                              inputWidth="32px"
                            />
                            <CompactStepper
                              value={line.pieces}
                              unitLabel={t('delivery_reps.van_pre_sales_tab.s50', "قطع")}
                              onIncrement={() => handleCartDelta(line.productId, 'piece', 1)}
                              onDecrement={() => handleCartDelta(line.productId, 'piece', -1)}
                              onChange={(val) => {
                                const prod = catalogProducts.find((p) => p.id === line.productId);
                                if (prod) handleUpdateProductUnits(prod, line.cartons, val);
                              }}
                              disabledDecrement={line.pieces <= 0}
                              height="28px"
                              inputWidth="32px"
                            />
                          </>
                        ) : (
                          <CompactStepper
                            value={line.quantity}
                            unitLabel={t('delivery_reps.van_pre_sales_tab.s51', "قطع")}
                            onIncrement={() => handleCartDelta(line.productId, 'piece', 1)}
                            onDecrement={() => handleCartDelta(line.productId, 'piece', -1)}
                            onChange={(val) => {
                              const prod = catalogProducts.find((p) => p.id === line.productId);
                              if (prod) handleUpdateProductUnits(prod, 0, val);
                            }}
                            disabledDecrement={line.quantity <= 0}
                            height="28px"
                            inputWidth="34px"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* COMMERCIAL SUMMARY STRIP */}
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: '9px',
                  padding: '9px 12px',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: '#475569' }}>
                  <span>{t('delivery_reps.van_pre_sales_tab.s52', "إجمالي الطلبية (سعر الآجل الأساسي):")}</span>
                  <span style={{ fontWeight: 700 }}>{cartGrossSubtotal.toFixed(2)} <CurrencySymbol /></span>
                </div>

                {paymentTerms === 'cash' ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: '#059669', fontWeight: 700 }}>
                    <span>{t('delivery_reps.van_pre_sales_tab.s53', "خصم تعجيل دفع (سداد نقدي):")}</span>
                    <span>-{cartDiscountAmount.toFixed(2)} <CurrencySymbol /></span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#b45309' }}>
                    <span>{t('delivery_reps.van_pre_sales_tab.s54', "خصم تعجيل دفع (سداد نقدي):")}</span>
                    <span>0.00 <CurrencySymbol /> {t('delivery_reps.van_pre_sales_tab.s55', "(غير مستحق في البيع الآجل)")}</span>
                  </div>
                )}

                <div style={{ height: '1px', backgroundColor: '#e2e8f0', margin: '2px 0' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: '12.5px', color: '#0f172a' }}>
                    {paymentTerms === 'cash' ? t('delivery_reps.van_pre_sales_tab.s56', "الصافي المطلوب سداده (كاش):") : t('delivery_reps.van_pre_sales_tab.s57', "صافي الحساب على العميل (آجل):")}
                  </span>
                  <span style={{ fontWeight: 900, fontSize: '14.5px', color: paymentTerms === 'cash' ? '#059669' : '#170e5e' }}>
                    {cartNetTotal.toFixed(2)} <CurrencySymbol />
                  </span>
                </div>
              </div>

              {/* IN-CART CUSTOMER SELECTOR */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="cart-customer-select" style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>
                    {t('delivery_reps.van_pre_sales_tab.s58', "العميل:")}
                  </label>
                  {selectedCustomer && (
                    <button
                      type="button"
                      onClick={() => onSelectCustomer('')}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#170e5e',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                        textDecoration: 'underline',
                      }}
                    >
                      {t('delivery_reps.van_pre_sales_tab.s59', "تغيير العميل")}
                    </button>
                  )}
                </div>

                <select
                  id="cart-customer-select"
                  value={selectedCustomerId}
                  onChange={(e) => onSelectCustomer(e.target.value ? Number(e.target.value) : '')}
                  style={{
                    width: '100%',
                    height: '34px',
                    padding: '0 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#0f172a',
                    backgroundColor: '#ffffff',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="">{t('delivery_reps.van_pre_sales_tab.s60', "-- اضغط هنا لاختيار العميل --")}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ''} {t('delivery_reps.van_pre_sales_tab.s61', "- رصيد:")} {Number(c.balance || 0).toFixed(0)}
                    </option>
                  ))}
                </select>

                {selectedCustomer && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: '#64748b', padding: '1px 2px' }}>
                    <span>
                      {t('delivery_reps.van_pre_sales_tab.s62', "الرصيد:")} <strong style={{ color: Number(selectedCustomer.balance) > 0 ? '#b91c1c' : '#15803d' }}>{Number(selectedCustomer.balance || 0).toFixed(2)} <CurrencySymbol /></strong>
                    </span>
                    <span>
                      {t('delivery_reps.van_pre_sales_tab.s63', "سقف الائتمان:")} <strong style={{ color: '#170e5e' }}>{selectedCustomer.creditLimit ? `${Number(selectedCustomer.creditLimit).toFixed(2)}` : t('delivery_reps.van_pre_sales_tab.s64', "غير محدد")}</strong>
                    </span>
                  </div>
                )}
              </div>

              {/* DETAILS & SUBMIT */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: '#64748b' }}>{t('delivery_reps.van_pre_sales_tab.s65', "تاريخ التسليم المقترح:")}</label>
                  <input
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    style={{
                      width: '100%',
                      height: '32px',
                      padding: '0 6px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '11.5px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: '#64748b' }}>{t('delivery_reps.van_pre_sales_tab.s66', "ملاحظات التجهيز:")}</label>
                  <input
                    type="text"
                    placeholder={t('delivery_reps.van_pre_sales_tab.s67', "ملاحظات للمخزن...")}
                    value={bookingNotes}
                    onChange={(e) => setBookingNotes(e.target.value)}
                    style={{
                      width: '100%',
                      height: '32px',
                      padding: '0 8px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '11.5px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <Button
                variant="primary"
                onClick={handleConfirmOrder}
                disabled={createOrderMutation.isPending}
                style={{
                  height: '40px',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  borderRadius: '8px',
                  marginTop: '4px',
                  cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                }}
              >
                <CheckCircleIcon size={16} />
                <span>
                  {createOrderMutation.isPending
                    ? t('delivery_reps.van_pre_sales_tab.s68', "جاري الحجز وتثبيت المخزون...")
                    : !selectedCustomerId
                    ? `اختر العميل لتأكيد الحجز (${cartNetTotal.toFixed(2)})`
                    : `تأكيد حجز الطلبية [${paymentTerms === 'cash' ? t('delivery_reps.van_pre_sales_tab.s69', "كاش نقدي") : t('delivery_reps.van_pre_sales_tab.s70', "آجل")}] (${cartNetTotal.toFixed(2)})`}
                </span>
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* MY ORDERS SUB-TAB */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{t('delivery_reps.van_pre_sales_tab.s71', "سجل طلبياتي المحجوزة:")}</span>
            <Button
              variant="secondary"
              onClick={() => refetchMyOrders()}
              disabled={isMyOrdersFetching}
              style={{ height: '30px', padding: '0 8px', fontSize: '11px' }}
            >
              <RefreshCwIcon size={13} className={isMyOrdersFetching ? 'spin' : ''} />
              <span>{t('delivery_reps.van_pre_sales_tab.s72', "تحديث")}</span>
            </Button>
          </div>

          {isMyOrdersLoading ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '12px' }}>
              {t('delivery_reps.van_pre_sales_tab.s73', "جاري تحميل طلبياتك...")}
            </div>
          ) : myOrders.length === 0 ? (
            <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '30px', textAlign: 'center', color: '#64748b', fontSize: '12.5px' }}>
              {t('delivery_reps.van_pre_sales_tab.s74', "لم تقم بحجز أي طلبيات مسبقة حتى الآن.")}
            </div>
          ) : (
            myOrders.map((ord) => (
              <div
                key={ord.id}
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#170e5e', fontSize: '12px' }}>
                    #{ord.orderNumber}
                  </span>
                  {getOrderStatusBadge(ord.status)}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>
                    {t('delivery_reps.van_pre_sales_tab.s75', "العميل:")} <strong style={{ color: '#0f172a' }}>{ord.customerName}</strong>
                  </span>
                  <span style={{ fontWeight: 800, color: '#059669' }}>
                    {Number(ord.totalAmount).toFixed(2)} <CurrencySymbol />
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' }}>
                  <span>
                    <span style={{ fontWeight: 700, color: ord.paymentTerms === 'cash' ? '#15803d' : '#b45309' }}>
                      {ord.paymentTerms === 'cash' ? t('delivery_reps.van_pre_sales_tab.s76', "كاش نقدي") : t('delivery_reps.van_pre_sales_tab.s77', "آجل على الحساب")}
                    </span>
                    {ord.discountAmount != null && ord.discountAmount > 0 ? (
                      <span style={{ marginInlineStart: '6px', color: '#059669', fontWeight: 700 }}>
                        {t('delivery_reps.van_pre_sales_tab.s78', "(خصم تعجيل: -")}{Number(ord.discountAmount).toFixed(2)})
                      </span>
                    ) : null}
                    {' '}| {ord.itemsCount} {t('delivery_reps.van_pre_sales_tab.s79', "أصناف")}
                  </span>
                  <span>
                    {ord.createdAt ? new Date(ord.createdAt).toLocaleDateString('ar-EG') : ''}
                  </span>
                </div>

                {ord.supervisorRejectionReason ? (
                  <div style={{ fontSize: '11px', color: '#b91c1c', backgroundColor: '#fef2f2', padding: '4px 8px', borderRadius: '4px' }}>
                    <b>{t('delivery_reps.van_pre_sales_tab.s80', "سبب الرفض:")}</b> {ord.supervisorRejectionReason}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}

      {/* 5. ALL CATEGORIES MODAL (BottomSheet Dialog) */}
      {allCategoriesModalOpen && (
        <StandardDialog
          open={allCategoriesModalOpen}
          onClose={() => setAllCategoriesModalOpen(false)}
          title={t('delivery_reps.van_pre_sales_tab.s81', "اختيار قسم المنتجات")}
          subtitle={`أقسام (${selectedCompany === '__ALL__' ? t('delivery_reps.van_pre_sales_tab.s82', "كافة الشركات") : selectedCompany}) • انقر لاختيار القسم وتصفية الأصناف فوراً`}
          badge={`${companyCategories.length} قسم`}
          width="min(520px, 95vw)"
          compact={true}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} dir="rtl">
            {/* Search Input for categories if more than 5 */}
            {companyCategories.length > 5 && (
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={categoryModalSearch}
                  onChange={(e) => setCategoryModalSearch(e.target.value)}
                  placeholder={t('delivery_reps.van_pre_sales_tab.s83', "ابحث عن قسم...")}
                  style={{
                    width: '100%',
                    height: '34px',
                    padding: '0 32px 0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
                <div style={{ position: 'absolute', right: '9px', top: '9px', pointerEvents: 'none', color: '#94a3b8' }}>
                  <SearchIcon size={14} />
                </div>
                {categoryModalSearch && (
                  <button
                    type="button"
                    onClick={() => setCategoryModalSearch('')}
                    style={{
                      position: 'absolute',
                      left: '8px',
                      top: '8px',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      padding: 0,
                    }}
                  >
                    <XIcon size={14} />
                  </button>
                )}
              </div>
            )}

            {/* Grid of categories */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))',
                gap: '8px',
                maxHeight: '340px',
                overflowY: 'auto',
                padding: '2px',
              }}
            >
              {/* Option: All Categories */}
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('all');
                  setAllCategoriesModalOpen(false);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  gap: '3px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: selectedCategory === 'all' ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                  backgroundColor: selectedCategory === 'all' ? '#eef2ff' : '#ffffff',
                  color: selectedCategory === 'all' ? '#170e5e' : '#0f172a',
                  cursor: 'pointer',
                  textAlign: 'right',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800 }}>{t('delivery_reps.van_pre_sales_tab.s84', "كافة الأقسام")}</span>
                  {selectedCategory === 'all' && <CheckCircleIcon size={13} color="#170e5e" />}
                </div>
                <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                  {selectedCompany === '__ALL__' ? catalogProducts.length : catalogProducts.filter((p) => ((p.supplierName || '').trim() || t('delivery_reps.van_pre_sales_tab.s85', "الشركة العامة")) === selectedCompany).length} {t('delivery_reps.van_pre_sales_tab.s86', "صنف")}
                </span>
              </button>

              {/* Company Categories */}
              {companyCategories
                .filter((cat) => !categoryModalSearch.trim() || cat.name.toLowerCase().includes(categoryModalSearch.trim().toLowerCase()))
                .map((cat) => {
                  const isSelected = selectedCategory === cat.name;
                  return (
                    <button
                      key={cat.name}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(cat.name);
                        setAllCategoriesModalOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        justifyContent: 'center',
                        gap: '3px',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        border: isSelected ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                        backgroundColor: isSelected ? '#eef2ff' : '#ffffff',
                        color: isSelected ? '#170e5e' : '#0f172a',
                        cursor: 'pointer',
                        textAlign: 'right',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <span style={{ fontSize: '12px', fontWeight: isSelected ? 800 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cat.name}
                        </span>
                        {isSelected && <CheckCircleIcon size={13} color="#170e5e" />}
                      </div>
                      <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                        {cat.count} {t('delivery_reps.van_pre_sales_tab.s87', "صنف")}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </StandardDialog>
      )}

      {/* 6. ORDER PREVIEW & CONFIRMATION MODAL */}
      <VanInvoiceReviewModal
        open={isReviewModalOpen}
        onClose={() => setIsReviewModalOpen(false)}
        onConfirm={() => {
          setIsReviewModalOpen(false);
          createOrderMutation.mutate();
        }}
        isSubmitting={createOrderMutation.isPending}
        customer={customers.find((c) => c.id === selectedCustomerId) || null}
        paymentTerms={paymentTerms}
        deliveryDate={deliveryDate}
        bookingNotes={bookingNotes}
        items={cart.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          unitName: line.unitName,
          cartons: line.cartons,
          pieces: line.pieces,
          totalPieces: line.quantity,
          cartonUnitPrice: line.cartonUnitPrice,
          pieceUnitPrice: line.pieceUnitPrice,
          unitPrice: line.unitPrice,
          subtotal:
            line.cartonMultiplier > 1 && (line.cartons > 0 || line.pieces > 0)
              ? line.cartons * line.cartonUnitPrice + line.pieces * line.pieceUnitPrice
              : line.quantity * line.pieceUnitPrice,
          warehouseAvailable: line.warehouseAvailable,
        }))}
        totalAmount={cartNetTotal}
        subtotal={cartGrossSubtotal}
        totalDiscount={cartDiscountAmount}
        title={t('delivery_reps.van_pre_sales_tab.s88', "معاينة تفاصيل الطلبية قبل الاعتماد النهائي")}
        subtitle={t('delivery_reps.van_pre_sales_tab.s89', "راجع الأصناف والكميات والأسعار بعناية، يمكنك التعديل أو التأكيد النهائي")}
        confirmButtonText={t('delivery_reps.van_pre_sales_tab.s90', "تأكيد نهائي لحجز الطلبية")}
        editButtonText={t('delivery_reps.van_pre_sales_tab.s91', "تعديل الأصناف والكميات")}
      />

      {/* 7. FLOATING ACTION BUTTON (FAB) FOR PRE-SALES */}
      <VanFloatingActionBar
        visible={activeSubTab === 'new-booking' && cart.length > 0}
        itemCount={cart.length}
        actionText={selectedCustomerId ? t('delivery_reps.van_pre_sales_tab.s92', "تأكيد الحجز") : t('delivery_reps.van_pre_sales_tab.s93', "اختر العميل")}
        onAction={() => {
          if (!selectedCustomerId) {
            toast.warning(t('delivery_reps.van_pre_sales_tab.s94', "يرجى اختيار العميل المطلوب حجز الطلبية له أولاً"));
            const el = document.getElementById('cart-customer-select');
            if (el) {
              el.focus();
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          } else {
            setIsReviewModalOpen(true);
          }
        }}
      />
    </div>
  );

  /**
   * Helper function to render a list of products with dual Carton & Piece steppers.
   */
  function renderProductsList(products: PreSalesCatalogItem[]) {
    if (isCatalogLoading) {
      return (
        <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '12px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          {t('delivery_reps.van_pre_sales_tab.s95', "جاري جلب رصيد المخزن الرئيسي والأسعار...")}
        </div>
      );
    }

    if (products.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '12px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          {t('delivery_reps.van_pre_sales_tab.s96', "لا توجد أصناف مطابقة في هذا القسم بالمخزن الرئيسي")}
        </div>
      );
    }

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        {products.map((prod) => {
          const isOutOfStock = prod.warehouseAvailable <= 0;
          const pricing = calculateItemPrice(prod, paymentTerms, 1, 1);
          const mult = prod.packagingUnit?.multiplier || 1;
          const isCartonItem = Boolean(prod.packagingUnit && mult > 1);

          // Get current selected quantities from cart
          const cartItem = cart.find((l) => l.productId === prod.id);
          const currentCartons = cartItem?.cartons || 0;
          const currentPieces = isCartonItem ? (cartItem?.pieces || 0) : (cartItem?.quantity || 0);
          const totalChosen = cartItem?.quantity || 0;

          // Available in cartons breakdown
          const availCartons = isCartonItem ? Math.floor(prod.warehouseAvailable / mult) : 0;
          const availPieces = isCartonItem ? prod.warehouseAvailable % mult : prod.warehouseAvailable;

          const lineTotal = isCartonItem
            ? currentCartons * (pricing.effectivePrice * mult) + currentPieces * pricing.effectivePrice
            : totalChosen * pricing.effectivePrice;

          return (
            <div
              key={prod.id}
              style={{
                border: totalChosen > 0 ? '1.5px solid #a5b4fc' : '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '8px 10px',
                backgroundColor: isOutOfStock && totalChosen === 0 ? '#f8fafc' : totalChosen > 0 ? '#fafbff' : '#ffffff',
                opacity: isOutOfStock && totalChosen === 0 ? 0.65 : 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                boxShadow: totalChosen > 0 ? '0 1px 4px rgba(99, 102, 241, 0.08)' : '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              {/* Row 1: Product Name, Pack Unit Pill, Barcode */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, fontSize: '12px', color: '#0f172a', lineHeight: 1.3 }}>
                      {prod.name}
                    </span>
                    {isCartonItem && (
                      <span
                        style={{
                          fontSize: '9.5px',
                          fontWeight: 700,
                          color: '#3730a3',
                          backgroundColor: '#eef2ff',
                          border: '1px solid #c7d2fe',
                          padding: '0.5px 5px',
                          borderRadius: '4px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {prod.packagingUnit?.name || t('delivery_reps.van_pre_sales_tab.s97', "كرتونة")} ({mult}{t('delivery_reps.van_pre_sales_tab.s98', "ق)")}
                      </span>
                    )}
                  </div>

                  {/* Subtitle: Supplier & Category in a tight single line */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#64748b' }}>
                    {selectedCompany === '__ALL__' && prod.supplierName && (
                      <>
                        <span style={{ whiteSpace: 'nowrap' }}>{prod.supplierName}</span>
                        <span>•</span>
                      </>
                    )}
                    {prod.categoryName && <span style={{ whiteSpace: 'nowrap' }}>{prod.categoryName}</span>}
                  </div>
                </div>

                {prod.barcode ? (
                  <span
                    style={{
                      fontSize: '9.5px',
                      color: '#64748b',
                      fontFamily: 'monospace',
                      backgroundColor: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {prod.barcode}
                  </span>
                ) : null}
              </div>

              {/* Row 2: Price & Available Stock (Single Balanced Row) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                {/* Price block */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#170e5e', fontWeight: 900, fontSize: '12.5px' }}>
                    {pricing.effectivePrice.toFixed(2)} <CurrencySymbol />
                    <span style={{ fontSize: '10px', fontWeight: 500, color: '#64748b' }}> {t('delivery_reps.van_pre_sales_tab.s99', "/ ق")}</span>
                  </span>

                  {paymentTerms === 'cash' && pricing.cashDiscountPerUnit > 0 && (
                    <span style={{ fontSize: '10px', color: '#94a3b8', textDecoration: 'line-through' }}>
                      {pricing.listPrice.toFixed(2)}
                    </span>
                  )}

                  {paymentTerms === 'cash' && pricing.cashDiscountPerUnit > 0 && (
                    <span
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 700,
                        color: '#059669',
                        backgroundColor: '#dcfce7',
                        border: '1px solid #86efac',
                        padding: '0.5px 5px',
                        borderRadius: '4px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t('delivery_reps.van_pre_sales_tab.s100', "وفر")} {pricing.cashDiscountPerUnit.toFixed(2)} {t('delivery_reps.van_pre_sales_tab.s101', "كاش")}
                    </span>
                  )}

                  {paymentTerms === 'credit' && (
                    <span style={{ color: '#b45309', fontSize: '9.5px', fontWeight: 700, backgroundColor: '#fef3c7', padding: '1px 5px', borderRadius: '4px' }}>
                      {t('delivery_reps.van_pre_sales_tab.s102', "(سعر الآجل)")}
                    </span>
                  )}

                  {isCartonItem && (
                    <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#4338ca', backgroundColor: '#eef2ff', padding: '1px 5px', borderRadius: '4px' }}>
                      {(pricing.effectivePrice * mult).toFixed(2)} / {prod.packagingUnit?.name || t('delivery_reps.van_pre_sales_tab.s103', "ك")}
                    </span>
                  )}

                  {pricing.consumerPrice ? (
                    <span style={{ fontSize: '10px', color: '#64748b' }}>
                      {t('delivery_reps.van_pre_sales_tab.s104', "(مستهلك:")} {pricing.consumerPrice.toFixed(2)})
                    </span>
                  ) : null}
                </div>

                {/* Stock badge */}
                <div style={{ flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color: isOutOfStock ? '#b91c1c' : '#047857',
                      backgroundColor: isOutOfStock ? '#fee2e2' : '#f0fdf4',
                      border: `1px solid ${isOutOfStock ? '#fca5a5' : '#bbf7d0'}`,
                      padding: '1.5px 6px',
                      borderRadius: '5px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: isOutOfStock ? '#ef4444' : '#10b981', display: 'inline-block' }} />
                    {isOutOfStock ? (
                      t('delivery_reps.van_pre_sales_tab.s105', "نفد من المخزن")
                    ) : isCartonItem ? (
                      `متاح: ${availCartons} ك ${availPieces > 0 ? `+ ${availPieces} ق` : ''} (${prod.warehouseAvailable} ق)`
                    ) : (
                      `متاح: ${prod.warehouseAvailable} قطعة`
                    )}
                  </span>
                </div>
              </div>

              {/* Row 3: Actions / Steppers (Height 28px - 30px) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: '3px',
                  borderTop: '1px dashed #f1f5f9',
                  gap: '6px',
                }}
              >
                {isOutOfStock && totalChosen === 0 ? (
                  <span style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 600 }}>{t('delivery_reps.van_pre_sales_tab.s106', "الصنف غير متوفر بالمخزن")}</span>
                ) : isCartonItem ? (
                  totalChosen === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                      <button
                        type="button"
                        onClick={() => handleUpdateProductUnits(prod, 1, 0)}
                        style={{
                          flex: 1,
                          height: '28px',
                          borderRadius: '6px',
                          border: 'none',
                          backgroundColor: '#170e5e',
                          color: '#ffffff',
                          fontSize: '11px',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                        }}
                      >
                        <PlusIcon size={12} color="#ffffff" />
                        <span>{t('delivery_reps.van_pre_sales_tab.s107', "+ حجز")} {prod.packagingUnit?.name || t('delivery_reps.van_pre_sales_tab.s108', "كرتونة")} ({mult}{t('delivery_reps.van_pre_sales_tab.s109', "ق)")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateProductUnits(prod, 0, 1)}
                        style={{
                          height: '28px',
                          padding: '0 10px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: '#f8fafc',
                          color: '#334155',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '3px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <PlusIcon size={11} color="#64748b" />
                        <span>{t('delivery_reps.van_pre_sales_tab.s110', "+ بالقطعة")}</span>
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <CompactStepper
                          value={currentCartons}
                          unitLabel={prod.packagingUnit?.name || t('delivery_reps.van_pre_sales_tab.s111', "كرتونة")}
                          onIncrement={() => handleUpdateProductUnits(prod, currentCartons + 1, currentPieces)}
                          onDecrement={() => handleUpdateProductUnits(prod, Math.max(0, currentCartons - 1), currentPieces)}
                          onChange={(val) => handleUpdateProductUnits(prod, val, currentPieces)}
                          disabledDecrement={currentCartons <= 0}
                          height="27px"
                          inputWidth="30px"
                        />
                        <span style={{ fontWeight: 800, color: '#94a3b8', fontSize: '11px' }}>+</span>
                        <CompactStepper
                          value={currentPieces}
                          unitLabel={t('delivery_reps.van_pre_sales_tab.s112', "قطع")}
                          onIncrement={() => handleUpdateProductUnits(prod, currentCartons, currentPieces + 1)}
                          onDecrement={() => handleUpdateProductUnits(prod, currentCartons, Math.max(0, currentPieces - 1))}
                          onChange={(val) => handleUpdateProductUnits(prod, currentCartons, val)}
                          disabledDecrement={currentPieces <= 0}
                          height="27px"
                          inputWidth="30px"
                        />
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                        <span style={{ fontWeight: 700, color: '#64748b' }}>
                          ({totalChosen} {t('delivery_reps.van_pre_sales_tab.s113', "ق)")}
                        </span>
                        <span style={{ fontWeight: 800, color: '#170e5e' }}>
                          {lineTotal.toFixed(2)} <CurrencySymbol />
                        </span>
                      </div>
                    </div>
                  )
                ) : (
                  totalChosen === 0 ? (
                    <button
                      type="button"
                      onClick={() => handleUpdateProductUnits(prod, 0, 1)}
                      style={{
                        width: '100%',
                        height: '28px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: '#170e5e',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                      }}
                    >
                      <PlusIcon size={12} color="#ffffff" />
                      <span>{t('delivery_reps.van_pre_sales_tab.s114', "+ إضافة للطلبية")}</span>
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e' }}>
                        {t('delivery_reps.van_pre_sales_tab.s115', "القيمة:")} {lineTotal.toFixed(2)} <CurrencySymbol />
                      </span>
                      <CompactStepper
                        value={currentPieces}
                        unitLabel={t('delivery_reps.van_pre_sales_tab.s116', "قطع")}
                        onIncrement={() => handleUpdateProductUnits(prod, 0, currentPieces + 1)}
                        onDecrement={() => handleUpdateProductUnits(prod, 0, Math.max(0, currentPieces - 1))}
                        onChange={(val) => handleUpdateProductUnits(prod, 0, val)}
                        disabledDecrement={currentPieces <= 0}
                        height="27px"
                        inputWidth="34px"
                      />
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
};
