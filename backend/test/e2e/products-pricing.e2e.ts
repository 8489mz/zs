import assert from 'node:assert/strict';
import { E2EClient, expectArray, findByName, uniqueSuffix } from './e2e-utils';

async function main() {
  const port = process.env.APP_PORT || 3101;
  const baseUrl = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;
  const clientA = new E2EClient(baseUrl);
  const clientB = new E2EClient(baseUrl);

  console.log('Logging in to Tenant A...');
  await clientA.login('dev', '1');

  console.log('Logging in to Tenant B...');
  await clientB.login('t2_admin', '1');

  const suffix = uniqueSuffix('prod-price');
  const standardName = `E2E Standard ${suffix}`;
  const fashionName = `E2E Fashion ${suffix}`;

  // Create Category & Supplier for Tenant A
  await clientA.post('/api/categories', { name: `Cat ${suffix}` }, 201);
  const categoriesPayload = await clientA.get('/api/categories');
  const category = expectArray(categoriesPayload.categories, 'categories').find((c: any) => c.name === `Cat ${suffix}`);

  await clientA.post('/api/suppliers', { name: `Sup ${suffix}`, phone: '', address: '', balance: 0, notes: '' }, 201);
  const suppliersPayload = await clientA.get('/api/suppliers');
  const supplier = expectArray(suppliersPayload.suppliers, 'suppliers').find((s: any) => s.name === `Sup ${suffix}`);

  // Create Customer for Sales
  await clientA.post(
    '/api/customers',
    {
      name: `Cust ${suffix}`,
      phone: '01012345678',
      address: '',
      balance: 0,
      type: 'cash',
      creditLimit: 0,
      storeCreditBalance: 0,
    },
    201,
  );
  const customersPayload = await clientA.get('/api/customers');
  const customer = expectArray(customersPayload.customers, 'customers').find((c: any) => c.name === `Cust ${suffix}`);

  // Create Location for Sales
  const createLocationRes = await clientA.post(
    '/api/settings/locations',
    { name: `Loc ${suffix}`, locationType: 'internal_warehouse' },
    201,
  );
  const location = createLocationRes.location || createLocationRes;

  // 1. Standard Product with Units and Pricing
  const baseBarcode = `B${Date.now()}1`;
  const subBarcode = `S${Date.now()}2`;
  await clientA.post(
    '/api/products',
    {
      name: standardName,
      barcode: baseBarcode,
      categoryId: Number(category.id),
      supplierId: Number(supplier.id),
      costPrice: 50,
      retailPrice: 100,
      wholesalePrice: 80,
      minStock: 5,
      notes: 'Testing pricing and units',
      stock: 0,
      units: [
        {
          name: 'قطعة',
          multiplier: 1,
          barcode: subBarcode,
          isBaseUnit: true,
          isSaleUnit: true,
          isPurchaseUnit: false,
        },
        {
          name: 'كرتونة',
          multiplier: 12,
          barcode: baseBarcode,
          isBaseUnit: false,
          isSaleUnit: false,
          isPurchaseUnit: true,
        },
      ],
    },
    201,
  );

  const productsPayload = await clientA.get(`/api/products?q=${encodeURIComponent(standardName)}`);
  const products = expectArray(productsPayload.products, 'products');
  const stdProduct = findByName(products, standardName);

  console.log('stdProduct:', stdProduct);
  assert.equal(Number(stdProduct.costPrice || stdProduct.cost_price), 50, 'Cost price mismatch');
  assert.equal(Number(stdProduct.retailPrice || stdProduct.retail_price), 100, 'Retail price mismatch');
  assert.equal(Number(stdProduct.wholesalePrice || stdProduct.wholesale_price), 80, 'Wholesale price mismatch');

  // Test preventing duplicate barcodes
  const duplicateRes = await clientA.post(
    '/api/products',
    {
      name: `Duplicate ${suffix}`,
      barcode: subBarcode, // Same as subBarcode
      costPrice: 10,
      retailPrice: 15,
      wholesalePrice: 12,
      minStock: 0,
      units: [],
    },
    409,
  );
  assert.notEqual(duplicateRes.ok, true, 'Should fail creating product with duplicate barcode');

  // 2. Purchase Standard Product (Buy 1 Carton = 12 Pieces)
  await clientA.post(
    '/api/purchases',
    {
      locationId: Number(location.id),
      supplierId: Number(supplier.id),
      paymentType: 'cash',
      discount: 0,
      taxRate: 0,
      pricesIncludeTax: false,
      items: [{ productId: Number(stdProduct.id), qty: 1, cost: 600, unitName: 'كرتونة', unitMultiplier: 12 }],
    },
    201,
  );

  // 3. Sell 3 Pieces Retail
  const sale = await clientA.post(
    '/api/sales',
    {
      locationId: Number(location.id),
      customerId: Number(customer.id),
      paymentType: 'cash',
      paymentChannel: 'cash',
      discount: 0,
      taxRate: 0,
      pricesIncludeTax: false,
      items: [
        {
          productId: Number(stdProduct.id),
          qty: 3,
          price: 100,
          unitName: 'قطعة',
          unitMultiplier: 1,
          priceType: 'retail',
        },
      ],
      payments: [{ paymentChannel: 'cash', amount: 300 }],
    },
    201,
  );
  assert.equal(sale.ok, true, 'Sale should succeed');

  // Verify Inventory (Started with 12, sold 3 = 9 left)
  // Verify Inventory (Started with 12, sold 3 = 9 left)
  const posProducts = await clientA.get(
    `/api/catalog/pos-products?q=${encodeURIComponent(standardName)}&requestedLocationId=${location.id}`,
  );
  const posStdProd = expectArray(posProducts.products, 'pos-products').find((p: any) => p.id === stdProduct.id);
  console.log('posStdProd:', posStdProd);
  assert.equal(
    Number(posStdProd.stockQty ?? posStdProd.stock_qty ?? posStdProd.stock),
    9,
    'Stock deduction for units failed',
  );

  // 4. Fashion Products
  const styleCode = `${Date.now()}`;
  const fVar1Barcode = `FV${Date.now()}1`;
  const fVar2Barcode = `FV${Date.now()}2`;
  await clientA.post(
    '/api/products',
    {
      name: fashionName,
      itemType: 'product',
      itemKind: 'fashion',
      styleCode: styleCode,
      categoryId: Number(category.id),
      supplierId: Number(supplier.id),
      costPrice: 150,
      retailPrice: 300,
      wholesalePrice: 250,
      minStock: 0,
      units: [{ name: 'قطعة', multiplier: 1, barcode: '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
      fashionVariants: [
        { color: 'Red', size: 'M', barcode: fVar1Barcode, stock: 0 },
        { color: 'Blue', size: 'L', barcode: fVar2Barcode, stock: 0 },
      ],
    },
    201,
  );

  const fashionSearch = await clientA.get(`/api/products?q=${encodeURIComponent(styleCode)}`);
  const fashionList = expectArray(fashionSearch.products, 'fashion products');
  assert.equal(fashionList.length, 2, 'Should create 2 separate variants for fashion style');

  const varRed = fashionList.find((p: any) => p.color === 'Red');
  const varBlue = fashionList.find((p: any) => p.color === 'Blue');
  assert.ok(varRed && varBlue, 'Variants should exist with correct colors');

  // Purchase only Red variant
  await clientA.post(
    '/api/purchases',
    {
      locationId: Number(location.id),
      supplierId: Number(supplier.id),
      paymentType: 'cash',
      discount: 0,
      taxRate: 0,
      pricesIncludeTax: false,
      items: [{ productId: Number(varRed.id), qty: 10, cost: 150, unitName: 'قطعة', unitMultiplier: 1 }],
    },
    201,
  );

  // Sell 3 Red variant items
  await clientA.post(
    '/api/sales',
    {
      locationId: Number(location.id),
      customerId: Number(customer.id),
      paymentType: 'cash',
      paymentChannel: 'cash',
      discount: 0,
      taxRate: 0,
      pricesIncludeTax: false,
      items: [
        { productId: Number(varRed.id), qty: 3, price: 300, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail' },
      ],
      payments: [{ paymentChannel: 'cash', amount: 900 }],
    },
    201,
  );

  // Verify only Red variant stock was deducted
  const posFashionRed = expectArray(
    (
      await clientA.get(
        `/api/catalog/pos-products?q=${encodeURIComponent(varRed.barcode)}&requestedLocationId=${location.id}`,
      )
    ).products,
    'pos-red',
  ).find((p: any) => p.id === varRed.id);
  const posFashionBlue = expectArray(
    (
      await clientA.get(
        `/api/catalog/pos-products?q=${encodeURIComponent(varBlue.barcode)}&requestedLocationId=${location.id}`,
      )
    ).products,
    'pos-blue',
  ).find((p: any) => p.id === varBlue.id);

  assert.equal(
    Number(posFashionRed.stockQty ?? posFashionRed.stock_qty ?? posFashionRed.stock),
    7,
    'Red variant stock deduction failed',
  );
  assert.equal(
    Number(posFashionBlue.stockQty ?? posFashionBlue.stock_qty ?? posFashionBlue.stock),
    0,
    'Blue variant stock should remain 0',
  );

  // 5. Weighted Barcode Simulation (Frontend logic)
  const weightProdCode = '00010';
  await clientA.post(
    '/api/products',
    {
      name: `Weighted ${suffix}`,
      barcode: weightProdCode,
      categoryId: Number(category.id),
      supplierId: Number(supplier.id),
      costPrice: 50,
      retailPrice: 100,
      wholesalePrice: 80,
      minStock: 0,
      units: [{ name: 'kg', multiplier: 1, barcode: '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
    },
    201,
  );
  const wProductsPayload = await clientA.get(`/api/products?q=${weightProdCode}`);
  const wProduct = expectArray(wProductsPayload.products, 'w-products').find((p: any) => p.barcode === weightProdCode);

  await clientA.post(
    '/api/purchases',
    {
      locationId: Number(location.id),
      supplierId: Number(supplier.id),
      paymentType: 'cash',
      discount: 0,
      taxRate: 0,
      pricesIncludeTax: false,
      items: [{ productId: Number(wProduct.id), qty: 100, cost: 50, unitName: 'kg', unitMultiplier: 1 }],
    },
    201,
  );

  // Valid Weighted Barcode: Prefix(21) + Code(00010) + Weight(01500 = 1.5kg) + check(1)
  const validWeightedBarcode = '2100010015001';
  // Simulate frontend parsing
  const parsedQty = 1500 / 1000; // 1.5

  await clientA.post(
    '/api/sales',
    {
      locationId: Number(location.id),
      customerId: Number(customer.id),
      paymentType: 'cash',
      paymentChannel: 'cash',
      discount: 0,
      taxRate: 0,
      pricesIncludeTax: false,
      items: [
        {
          productId: Number(wProduct.id),
          qty: parsedQty,
          price: 100,
          unitName: 'kg',
          unitMultiplier: 1,
          priceType: 'retail',
        },
      ],
      payments: [{ paymentChannel: 'cash', amount: 150 }],
    },
    201,
  );

  const posWProduct = expectArray(
    (await clientA.get(`/api/catalog/pos-products?q=${weightProdCode}&requestedLocationId=${location.id}`)).products,
    'pos-w',
  ).find((p: any) => p.id === wProduct.id);
  assert.equal(
    Number(posWProduct.stockQty ?? posWProduct.stock_qty ?? posWProduct.stock),
    98.5,
    'Weighted product stock deduction failed',
  );

  // Invalid Barcode Simulation
  const invalidProductsPayload = await clientA.get(
    `/api/catalog/pos-products?q=INVALID_BARCODE&requestedLocationId=${location.id}`,
  );
  assert.equal(
    expectArray(invalidProductsPayload.products, 'invalid products').length,
    0,
    'Invalid barcode should not return products',
  );

  // Check Isolation - Tenant B should NOT see these products
  const bProducts = await clientB.get(`/api/products?q=${encodeURIComponent(suffix)}`);
  const bList = expectArray(bProducts.products, 'tenant B products');
  assert.equal(bList.length, 0, 'Tenant B should not see Tenant A products');

  console.log('Products & Pricing E2E completed successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
