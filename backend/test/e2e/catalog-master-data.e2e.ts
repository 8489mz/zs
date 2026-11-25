import assert from 'node:assert/strict';
import { expectArray, findByName, loginClient, uniqueSuffix } from './e2e-utils';

async function main() {
  const client = await loginClient();
  const suffix = uniqueSuffix('catalog');
  const categoryName = `E2E Category ${suffix}`;
  const supplierName = `E2E Supplier ${suffix}`;
  const productName = `E2E Product ${suffix}`;

  await client.post('/api/categories', { name: categoryName }, 201);
  const categoriesPayload = await client.get('/api/categories');
  const categories = expectArray(categoriesPayload.categories, 'categories');
  const category = findByName(categories, categoryName);

  await client.post(
    '/api/suppliers',
    {
      name: supplierName,
      phone: '',
      address: '',
      balance: 0,
      notes: 'E2E supplier',
    },
    201,
  );
  const suppliersPayload = await client.get('/api/suppliers');
  const suppliers = expectArray(suppliersPayload.suppliers, 'suppliers');
  const supplier = findByName(suppliers, supplierName);

  await client.post(
    '/api/products',
    {
      name: productName,
      barcode: `${Date.now()}`,
      categoryId: Number(category.id),
      supplierId: Number(supplier.id),
      costPrice: 10,
      retailPrice: 15,
      wholesalePrice: 12,
      minStock: 2,
      notes: 'E2E product',
      stock: 0,
      units: [
        {
          name: 'قطعة',
          multiplier: 1,
          barcode: '',
          isBaseUnit: true,
          isSaleUnit: true,
          isPurchaseUnit: true,
        },
      ],
    },
    201,
  );

  const productsPayload = await client.get(`/api/products?q=${encodeURIComponent(productName)}`);
  const products = expectArray(productsPayload.products, 'products');
  const product = findByName(products, productName);
  assert.equal(Number(product.costPrice), 10);
  assert.equal(Number(product.retailPrice), 15);

  // Fashion regression: grouped creation, SKU lookup, atomic edit and safe archive.
  const styleCode = String(1_000_000 + Math.floor(Math.random() * 900_000));
  const fashionName = `E2E Fashion ${suffix}`;
  const redBarcode = `FRED-${suffix}`;
  const blueBarcode = `FBLUE-${suffix}`;
  const redSku = `SKU-RED-${suffix}`;
  const blackSku = `SKU-BLACK-${suffix}`;
  const unit = (barcode: string) => ({
    name: 'قطعة',
    multiplier: 1,
    barcode,
    isBaseUnit: true,
    isSaleUnit: true,
    isPurchaseUnit: true,
  });
  await client.post(
    '/api/products',
    {
      name: fashionName,
      itemKind: 'fashion',
      styleCode,
      categoryId: Number(category.id),
      supplierId: Number(supplier.id),
      costPrice: 60,
      retailPrice: 120,
      wholesalePrice: 100,
      minStock: 2,
      units: [unit('')],
      stock: 0,
      metadata: { origin: 'Egypt' },
      offers: [{ type: 'bogo', value: 0, bogoBuyQty: 1, bogoGetQty: 1, bogoDiscountPercent: 100 }],
      fashionVariants: [
        { color: 'أحمر', size: 'M', barcode: redBarcode, sku: redSku, stock: 0 },
        { color: 'أزرق', size: 'L', barcode: blueBarcode, sku: `SKU-BLUE-${suffix}`, stock: 0 },
      ],
    },
    201,
  );
  const beforeFashion = expectArray(
    (await client.get(`/api/products?q=${encodeURIComponent(styleCode)}`)).products,
    'fashion variants',
  );
  const red = beforeFashion.find((item) => item.color === 'احمر');
  const blue = beforeFashion.find((item) => item.color === 'ازرق');
  assert.ok(red && blue, 'Expected red and blue clothing variants');
  assert.equal(red.sku, redSku, 'Variant SKU must persist');
  assert.ok(red.catalogUpdatedAt, 'Variant catalog version should be returned for concurrency protection');
  const modelPage = await client.get(`/api/products?groupFashion=true&pageSize=5&q=${encodeURIComponent(styleCode)}`);
  assert.equal(modelPage.pagination.totalItems, 1, 'Model with two sizes must count as one page group');
  assert.equal(expectArray(modelPage.products, 'model-page').length, 2, 'Model page should contain all sizes');

  const row = (fields: Record<string, any>) => ({
    name: fields.name,
    itemKind: 'fashion',
    itemType: 'product',
    styleCode,
    expectedCatalogUpdatedAt: fields.expectedCatalogUpdatedAt,
    color: fields.color,
    size: fields.size,
    barcode: fields.barcode,
    sku: fields.sku,
    categoryId: Number(category.id),
    supplierId: Number(supplier.id),
    costPrice: 60,
    retailPrice: 120,
    wholesalePrice: 100,
    minStock: fields.minStock ?? 2,
    units: [unit(fields.barcode)],
    ...(fields.id ? { id: Number(fields.id) } : { stock: 0 }),
  });
  const edited = await client.put(`/api/products/fashion-groups/${styleCode}`, {
    rows: [
      row({
        id: red.id,
        name: red.name,
        color: 'أحمر',
        size: 'M',
        barcode: redBarcode,
        sku: redSku,
        minStock: 7,
        expectedCatalogUpdatedAt: red.catalogUpdatedAt,
      }),
      row({
        name: `${fashionName} - أسود / 42.5`,
        color: 'أسود',
        size: '42.5',
        barcode: `FBLK-${suffix}`,
        sku: blackSku,
      }),
    ],
  });
  assert.deepEqual([edited.updated, edited.created, edited.archived], [1, 1, 1]);

  const afterFashion = expectArray(
    (await client.get(`/api/products?q=${encodeURIComponent(styleCode)}`)).products,
    'updated fashion',
  );
  assert.equal(afterFashion.length, 2, 'Only active variants should be listed');
  const savedRed = afterFashion.find((item) => item.id === red.id);
  assert.equal(savedRed.minStock, 7);
  assert.equal(savedRed.sku, redSku);
  assert.equal(savedRed.offers?.[0]?.type, 'bogo', 'Existing promotion must be preserved');
  assert.equal(savedRed.metadata?.origin, 'Egypt', 'Existing metadata must be preserved');
  assert.equal(afterFashion.find((item) => item.sku === blackSku)?.size, '42.5');
  const scannedSku = expectArray(
    (await client.get(`/api/catalog/pos-products?barcode=${encodeURIComponent(blackSku)}`)).products,
    'exact SKU scan',
  );
  assert.ok(
    scannedSku.some((item) => item.sku === blackSku),
    'Barcode-mode POS scanner must resolve SKU',
  );

  const archived = expectArray(
    (await client.get(`/api/products?view=archived&q=${encodeURIComponent(styleCode)}`)).products,
    'archived fashion',
  );
  assert.ok(
    archived.some((item) => item.id === blue.id),
    'Removed variant must be archived, not deleted',
  );
  const skuSearch = expectArray(
    (await client.get(`/api/catalog/pos-products?q=${encodeURIComponent(blackSku)}`)).products,
    'pos SKU lookup',
  );
  assert.ok(
    skuSearch.some((item) => item.sku === blackSku),
    'POS should find variants by SKU',
  );

  await client.put(
    `/api/products/fashion-groups/${styleCode}`,
    {
      rows: [
        row({ id: red.id, name: red.name, color: 'أحمر', size: 'M', barcode: redBarcode, sku: redSku }),
        row({ name: 'E2E Duplicate', color: 'أحمر', size: 'M', barcode: `DIFF-${suffix}`, sku: `SKU-DIFF-${suffix}` }),
      ],
    },
    400,
  );
  // An edit based on the old catalog version must not silently overwrite another user's save.
  await client.put(
    `/api/products/fashion-groups/${styleCode}`,
    {
      rows: [
        row({
          id: red.id,
          name: red.name,
          color: 'أحمر',
          size: 'M',
          barcode: redBarcode,
          sku: redSku,
          expectedCatalogUpdatedAt: '2000-01-01T00:00:00.000Z',
        }),
        row({
          id: afterFashion.find((item) => item.sku === blackSku)?.id,
          name: `${fashionName} - أسود / 42.5`,
          color: 'أسود',
          size: '42.5',
          barcode: `FBLK-${suffix}`,
          sku: blackSku,
        }),
      ],
    },
    409,
  );
  const afterFailedEdit = expectArray(
    (await client.get(`/api/products?q=${encodeURIComponent(styleCode)}`)).products,
    'unchanged fashion',
  );
  assert.equal(afterFailedEdit.length, 2, 'Invalid bulk edit must not mutate the group');

  console.log('catalog-master-data.e2e: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
