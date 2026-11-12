import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { Test } from '@nestjs/testing';
import { Kysely } from '../../src/database/kysely';
import { Database } from '../../src/database/database.types';
import { KYSELY_DB } from '../../src/database/database.constants';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { SUPER_ADMIN_PERMISSIONS } from '../../src/core/auth/constants/super-admin-permissions';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { inspectAccountingIntegrity } from '../../src/modules/accounting/accounting-integrity';
import { PurchasesService } from '../../src/modules/purchases/purchases.service';
import { SalesService } from '../../src/modules/sales/sales.service';
import { ReturnsService } from '../../src/modules/returns/returns.service';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { KdsService } from '../../src/modules/sales/services/kds.service';
import { RestaurantFoodWasteService } from '../../src/modules/sales/services/restaurant-food-waste.service';
import { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { DeliveryAggregatorsService } from '../../src/modules/sales/services/delivery-aggregators.service';

const PASSWORD = 'DisposableAcceptance!2026#Only';
const cents = (n: unknown) => Number(Number(n).toFixed(2));

async function main(): Promise<void> {
  const target = process.env.ACCEPTANCE_DATABASE_URL;
  assert.ok(target, 'A disposable PostgreSQL ACCEPTANCE_DATABASE_URL is required');
  const url = new URL(target);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname), 'Only local disposable PostgreSQL');
  assert.ok(/^\/(zs_core_audit_test|zs_acceptance_[a-z0-9_]+)$/.test(url.pathname),
    'Refusing production and user databases');
  Object.assign(process.env, {
    NODE_ENV:'test', APP_MODE:'CLOUD_SAAS', TENANT_ID:'zs', ACCOUNT_ID:'zs',
    DATABASE_HOST:url.hostname, DATABASE_PORT:url.port || '5432', DATABASE_NAME:url.pathname.slice(1),
    DATABASE_USER:decodeURIComponent(url.username), DATABASE_PASSWORD:decodeURIComponent(url.password),
    DATABASE_SSL:'false', DATABASE_POOL_MAX:'8', SESSION_CSRF_SECRET:'disposable-priority-sectors-acceptance',
    ENABLE_BOOTSTRAP_ADMIN:'false', SMTP_HOST:'', ERROR_TRACKING_ENABLED:'false',
  });
  const { AppModule } = await import('../../src/app.module');
  const app = await Test.createTestingModule({imports:[AppModule]}).compile();
  const db = app.get<Kysely<Database>>(KYSELY_DB);
  const foundation = app.get(AccountingTenantFoundationService);
  const purchases = app.get(PurchasesService);
  const sales = app.get(SalesService);
  const returns = app.get(ReturnsService);
  const drawer = app.get(CashDrawerService);
  const kds = app.get(KdsService);
  const waste = app.get(RestaurantFoodWasteService);
  const couriers = app.get(DeliveryRepsService);
  const aggregators = app.get(DeliveryAggregatorsService);
  const tag = randomUUID().replaceAll('-','').slice(0,9);
  const creds = await createPasswordRecord(PASSWORD);

  type Shop = {auth:AuthContext;branchId:number;locationId:number;supplierId:number;customerId:number};
  async function shop(sector:string, features:string[]=[]):Promise<Shop> {
    const tenantId = `priority_${tag}_${sector}`;
    await db.insertInto('tenants').values({
      id:tenantId,slug:tenantId,business_name:tenantId,owner_name:'Acceptance',
      owner_phone:`${tag}${sector}`,owner_email:`${tenantId}@example.invalid`,
      activity_type:'retail_general',status:'active',plan_id:'plan_omnichannel',country_code:'EG',
      trial_starts_at:new Date(),trial_ends_at:new Date('2100-01-01'),activated_at:new Date(),
      extra_features:JSON.stringify(features),
    } as any).execute();
    const user = await db.insertInto('users').values({
      tenant_id:tenantId,account_id:tenantId,username:tenantId,phone:`${tag}${sector}`,
      password_hash:creds.hash,password_salt:creds.salt,role:'admin',is_active:true,
      must_change_password:false,permissions_json:JSON.stringify(SUPER_ADMIN_PERMISSIONS),
    } as any).returning('id').executeTakeFirstOrThrow();
    const auth:AuthContext={tenantId,accountId:tenantId,userId:Number(user.id),role:'admin',
      username:tenantId,sessionId:`session_${tenantId}`,permissions:[...SUPER_ADMIN_PERMISSIONS],
      extraFeatures:features,planId:'plan_omnichannel'};
    const branch=await db.insertInto('branches').values({tenant_id:tenantId,account_id:tenantId,
      name:'Sector test',code:`BR_${tenantId}`} as any).returning('id').executeTakeFirstOrThrow();
    const location=await db.insertInto('stock_locations').values({tenant_id:tenantId,account_id:tenantId,
      branch_id:Number(branch.id),name:'Main Store',code:`ST_${tenantId}`,
      location_type:'internal_warehouse',is_active:true} as any).returning('id').executeTakeFirstOrThrow();
    await db.updateTable('branches').set({default_stock_location_id:Number(location.id)})
      .where('tenant_id','=',tenantId).where('id','=',branch.id).execute();
    const supplier=await db.insertInto('suppliers').values({tenant_id:tenantId,account_id:tenantId,
      name:'Supplier',phone:'',address:'',notes:'',balance:0,is_active:true} as any).returning('id').executeTakeFirstOrThrow();
    const customer=await db.insertInto('customers').values({tenant_id:tenantId,account_id:tenantId,
      name:'Customer',phone:'',address:'',balance:0,store_credit_balance:0,is_active:true} as any).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('settings').values({tenant_id:tenantId,account_id:tenantId,key:'currency',value:'"EGP"'} as any).execute();
    await foundation.ensureForAuth(db,auth);
    await drawer.openCashierShift({openingCash:0,branchId:Number(branch.id),
      locationId:Number(location.id),password:PASSWORD},auth);
    return {auth,branchId:Number(branch.id),locationId:Number(location.id),
      supplierId:Number(supplier.id),customerId:Number(customer.id)};
  }
  async function product(f:Shop,name:string,barcode:string) {
    const row=await db.insertInto('products').values({tenant_id:f.auth.tenantId!,account_id:f.auth.accountId!,
      name,barcode:`${tag}_${barcode}`,cost_price:0,retail_price:60,wholesale_price:60,
      stock_qty:0,reserved_qty:0,is_active:true} as any).returning('id').executeTakeFirstOrThrow();
    return Number(row.id);
  }
  async function receive(f:Shop,productId:number,qty:number,cost:number){
    return purchases.createPurchase({supplierId:f.supplierId,paymentType:'credit',
      branchId:f.branchId,locationId:f.locationId,taxRate:0,pricesIncludeTax:false,
      items:[{productId,name:'Stock receipt',qty,cost,unitMultiplier:1,locationId:f.locationId}]},
      f.auth,randomUUID());
  }
  async function checkout(f:Shop,items:any[],extras:Record<string,unknown>={}) {
    const total=items.reduce((sum,item)=>sum+item.qty*(item.price+
      (item.modifiers||[]).reduce((m:number,x:any)=>m+Number(x.price||0)*Number(x.qty??1),0)),0);
    return sales.createSale({source:'pos',branchId:f.branchId,locationId:f.locationId,
      customerId:f.customerId,paymentType:'cash',paymentChannel:'cash',
      taxRate:0,pricesIncludeTax:false,items,
      payments:[{paymentChannel:'cash',amount:cents(total)}],...extras} as any,f.auth);
  }
  async function posted(f:Shop,code:string) {
    const q=await sql<{amount:string}>`select coalesce(sum(l.debit-l.credit),0) as amount
      from journal_entry_lines l
      join journal_entries j on j.id=l.journal_entry_id and j.tenant_id=l.tenant_id
      join accounting_accounts a on a.id=l.account_id and a.tenant_id=l.tenant_id
      where l.tenant_id=${f.auth.tenantId} and a.code=${code} and j.status='posted'`.execute(db);
    return cents(q.rows[0].amount);
  }
  async function check(f:Shop,ids:number[]){
    const rows=await db.selectFrom('products').select(['id','stock_qty','cost_price'])
      .where('tenant_id','=',f.auth.tenantId!).where('id','in',ids).execute();
    const inventory=cents(rows.reduce((s,p)=>s+Number(p.stock_qty)*Number(p.cost_price),0));
    assert.equal(await posted(f,'1140'),inventory,'GL inventory equals physical WAC for sector');
    const integrity=await inspectAccountingIntegrity(db,f.auth.tenantId!);
    assert.equal(integrity.passed,true,JSON.stringify(integrity));
    const unbalanced=await sql`select j.id from journal_entries j
      join journal_entry_lines l on l.journal_entry_id=j.id and l.tenant_id=j.tenant_id
      where j.tenant_id=${f.auth.tenantId} and j.status='posted'
      group by j.id having sum(l.debit)<>sum(l.credit)`.execute(db);
    assert.equal(unbalanced.rows.length,0,'no unbalanced sector journals');
  }
  try {
    // CLOTHING: separate color+size SKUs must never transfer stock/cost between variants.
    const fashion=await shop('clothing');
    const red=await product(fashion,'Jacket / RED / M','JACKET-RED-M');
    const blue=await product(fashion,'Jacket / BLUE / L','JACKET-BLUE-L');
    await receive(fashion,red,3,20);
    await receive(fashion,blue,2,25);
    const redSale=await checkout(fashion,[{productId:red,name:'Red M',qty:2,price:60,unitMultiplier:1}]);
    const redId=Number((redSale.sale as {id:string}).id);
    const line=await db.selectFrom('sale_items').select('id').where('tenant_id','=',fashion.auth.tenantId!)
      .where('sale_id','=',redId).where('product_id','=',red).executeTakeFirstOrThrow();
    await returns.createReturn({type:'sale',invoiceId:redId,items:[
      {productId:red,saleItemId:Number(line.id),qty:1}],settlementMode:'refund',refundMethod:'cash'},fashion.auth);
    const variants=await db.selectFrom('products').select(['id','stock_qty'])
      .where('tenant_id','=',fashion.auth.tenantId!).where('id','in',[red,blue]).execute();
    assert.equal(Number(variants.find(p=>Number(p.id)===red)!.stock_qty),2);
    assert.equal(Number(variants.find(p=>Number(p.id)===blue)!.stock_qty),2);
    assert.equal(await posted(fashion,'5100'),20,'partial return reverses only the returned variant COGS');
    await check(fashion,[red,blue]);
    console.log('PASS sector-clothing PostgreSQL SKU color/size isolation, POS cash sale, return, stock/WAC/GL');

    // Atomic same-customer size/color exchange: return the exact originally
    // sold RED/M line and receive BLUE/L without inventing another cash payment.
    const originalExchange=await checkout(fashion,[{productId:red,name:'Red M',qty:1,price:60,unitMultiplier:1}]);
    const origId=Number((originalExchange.sale as {id:string}).id);
    const origLine=await db.selectFrom('sale_items').select('id')
      .where('tenant_id','=',fashion.auth.tenantId!).where('sale_id','=',origId)
      .where('product_id','=',red).executeTakeFirstOrThrow();
    const exchanged=await sales.createSale({
      source:'pos',branchId:fashion.branchId,locationId:fashion.locationId,
      customerId:fashion.customerId,paymentType:'cash',paymentChannel:'cash',
      taxRate:0,pricesIncludeTax:false,managerPin:PASSWORD,exchangeSaleId:origId,
      exchangeRefundMethod:'store_credit',
      items:[
        {productId:red,name:'Returned Red M',qty:-1,price:60,unitMultiplier:1,
          originalSaleItemId:Number(origLine.id)},
        {productId:blue,name:'New Blue L',qty:1,price:60,unitMultiplier:1},
      ],payments:[],
    } as any,fashion.auth);
    assert.ok(Number((exchanged.sale as {id:string}).id)>0);
    const afterExchange=await db.selectFrom('products').select(['id','stock_qty'])
      .where('tenant_id','=',fashion.auth.tenantId!).where('id','in',[red,blue]).execute();
    assert.equal(Number(afterExchange.find(p=>Number(p.id)===red)!.stock_qty),2);
    assert.equal(Number(afterExchange.find(p=>Number(p.id)===blue)!.stock_qty),1);
    await check(fashion,[red,blue]);
    console.log('PASS sector-clothing PostgreSQL atomic color/size exchange and immutable inventory/GL matching');
    // A separate FULL return must not alter another colour/size or count the refund twice.
    const fullSale=await checkout(fashion,[{productId:red,name:'Red M full-return case',
      qty:1,price:60,unitMultiplier:1}]);
    const fullSaleId=Number((fullSale.sale as {id:string}).id);
    const fullLine=await db.selectFrom('sale_items').select('id')
      .where('tenant_id','=',fashion.auth.tenantId!).where('sale_id','=',fullSaleId)
      .where('product_id','=',red).executeTakeFirstOrThrow();
    await returns.createReturn({type:'sale',invoiceId:fullSaleId,
      items:[{productId:red,saleItemId:Number(fullLine.id),qty:1}],
      settlementMode:'refund',refundMethod:'cash'},fashion.auth);
    const fullReturnStocks=await db.selectFrom('products').select(['id','stock_qty'])
      .where('tenant_id','=',fashion.auth.tenantId!).where('id','in',[red,blue]).execute();
    assert.equal(Number(fullReturnStocks.find(p=>Number(p.id)===red)!.stock_qty),2);
    assert.equal(Number(fullReturnStocks.find(p=>Number(p.id)===blue)!.stock_qty),1);
    assert.equal(await posted(fashion,'1110'),120,'full sale + full refund leave no phantom cash');
    await check(fashion,[red,blue]);
    console.log('PASS sector-clothing PostgreSQL complete refund leaves variant stock and drawer unchanged');

    const clothingShift=await db.selectFrom('cashier_shifts').select('id')
      .where('tenant_id','=',fashion.auth.tenantId!).where('opened_by','=',fashion.auth.userId)
      .where('status','=','open').executeTakeFirstOrThrow();
    await drawer.closeCashierShift(Number(clothingShift.id),
      {countedCash:120,managerPin:PASSWORD},fashion.auth);
    const clothingClosed=await db.selectFrom('cashier_shifts').select(['status','expected_cash','variance'])
      .where('tenant_id','=',fashion.auth.tenantId!).where('id','=',clothingShift.id).executeTakeFirstOrThrow();
    assert.equal(clothingClosed.status,'closed');
    assert.equal(cents(clothingClosed.expected_cash),120,'cash sale minus partial cash refund plus exchange source sale');
    assert.equal(cents(clothingClosed.variance),0,'clothing till must reconcile to zero');
    assert.equal(await posted(fashion,'1110'),120,'clothing cash balance must match GL');
    await check(fashion,[red,blue]);
    console.log('PASS sector-clothing PostgreSQL partial return, size exchange, closed cash shift and GL');


    // MARKET: barcode selection + weighted fractional stock sale with an open till.
    const market=await shop('market');
    const weighted=await product(market,'Market weighable bulk food','WEIGHT-200');
    await receive(market,weighted,10,8);
    const byBarcode=await db.selectFrom('products').select('id')
      .where('tenant_id','=',market.auth.tenantId!).where('barcode','=',`${tag}_WEIGHT-200`).executeTakeFirstOrThrow();
    assert.equal(Number(byBarcode.id),weighted);
    const marketSale=await checkout(market,[{productId:weighted,name:'Bulk food',qty:2.375,price:12,unitMultiplier:1}]);
    const marketId=Number((marketSale.sale as {id:string}).id);
    const saved=await db.selectFrom('sale_items').select(['qty','line_total','cost_price'])
      .where('tenant_id','=',market.auth.tenantId!).where('sale_id','=',marketId).executeTakeFirstOrThrow();
    assert.equal(Number(saved.qty),2.375);
    assert.equal(Number(saved.line_total),28.5);
    assert.equal(await posted(market,'5100'),19);
    assert.equal(await posted(market,'1110'),28.5);
    await check(market,[weighted]);
    console.log('PASS sector-market PostgreSQL barcode, weighted POS, shift open, purchase, WAC, COGS, cash/GL');
    // Fractional return against the exact sold line; supplier settlement must be
    // counted once as cash-out, never as a second POS discount or stock movement.
    const marketLine=await db.selectFrom('sale_items').select('id')
      .where('tenant_id','=',market.auth.tenantId!).where('sale_id','=',marketId)
      .where('product_id','=',weighted).executeTakeFirstOrThrow();
    await returns.createReturn({type:'sale',invoiceId:marketId,
      items:[{productId:weighted,saleItemId:Number(marketLine.id),qty:0.375}],
      settlementMode:'refund',refundMethod:'cash'},market.auth);
    assert.equal(Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',market.auth.tenantId!).where('id','=',weighted)
      .executeTakeFirstOrThrow()).stock_qty),8);
    assert.equal(await posted(market,'5100'),16,'fractional return reverses exact sold WAC');
    assert.equal(await posted(market,'1110'),24,'fractional return refunds 4.50');

    const supplierPaymentKey=randomUUID();
    await purchases.createSupplierPayment({supplierId:market.supplierId,amount:15,
      paymentChannel:'cash',branchId:market.branchId,locationId:market.locationId},
      market.auth,supplierPaymentKey);
    const paymentsAfterFirst=await db.selectFrom('supplier_payments')
      .select(db.fn.countAll().as('n')).where('tenant_id','=',market.auth.tenantId!)
      .executeTakeFirstOrThrow();
    await purchases.createSupplierPayment({supplierId:market.supplierId,amount:15,
      paymentChannel:'cash',branchId:market.branchId,locationId:market.locationId},
      market.auth,supplierPaymentKey);
    const paymentsAfterRetry=await db.selectFrom('supplier_payments')
      .select(db.fn.countAll().as('n')).where('tenant_id','=',market.auth.tenantId!)
      .executeTakeFirstOrThrow();
    assert.equal(Number(paymentsAfterFirst.n),1);
    assert.equal(Number(paymentsAfterRetry.n),1,'repeated supplier settlement must be idempotent');
    assert.equal(await posted(market,'1110'),9,'market cash 28.50 - 4.50 refund - 15 supplier');
    await check(market,[weighted]);
    console.log('PASS sector-market PostgreSQL fractional return, supplier cash settlement and idempotent retry');

    const marketShift=await db.selectFrom('cashier_shifts').select('id')
      .where('tenant_id','=',market.auth.tenantId!).where('opened_by','=',market.auth.userId)
      .where('status','=','open').executeTakeFirstOrThrow();
    await drawer.closeCashierShift(Number(marketShift.id),
      {countedCash:9,managerPin:PASSWORD},market.auth);
    const closed=await db.selectFrom('cashier_shifts').select(['status','expected_cash','variance'])
      .where('tenant_id','=',market.auth.tenantId!).where('id','=',marketShift.id).executeTakeFirstOrThrow();
    assert.equal(closed.status,'closed');
    assert.equal(cents(closed.expected_cash),9);
    assert.equal(cents(closed.variance),0);
    console.log('PASS sector-market PostgreSQL exact shift close balances cash POS and zero variance');

    // RESTAURANT: the real sale service must deduct a costed modifier from raw
    // ingredient stock and POST that identical amount to COGS (not spoofed costPrice).
    const rest=await shop('restaurant',['restaurant']);
    const meal=await product(rest,'Bistro meal','MEAL');
    const cheese=await product(rest,'Cheese ingredient / kg','CHEESE');
    await receive(rest,meal,2,4);
    await receive(rest,cheese,2,10);
    const rSale=await checkout(rest,[{productId:meal,name:'Bistro meal',qty:1,price:60,
      unitMultiplier:1,modifiers:[{productId:cheese,name:'Cheese',qty:0.2,price:0,costPrice:500}]}],
      {tableNumber:'T-4',orderType:'dine_in',guestCount:2});
    const rId=Number((rSale.sale as {id:string}).id);
    const restaurantLine=await db.selectFrom('sale_items').select(['cost_price','modifiers'])
      .where('tenant_id','=',rest.auth.tenantId!).where('sale_id','=',rId).executeTakeFirstOrThrow();
    assert.equal(Number(restaurantLine.cost_price),6,
      'one meal WAC 4 + 0.2 ingredient WAC 10; ignore spoofed cost 500');
    const recordedMods=typeof restaurantLine.modifiers==='string'
      ? JSON.parse(restaurantLine.modifiers) : restaurantLine.modifiers;
    assert.equal(Number(recordedMods[0].costPrice),10,'persist authoritative ingredient WAC');
    const ingredient=await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',cheese).executeTakeFirstOrThrow();
    assert.equal(Number(ingredient.stock_qty),1.8);
    assert.equal(await posted(rest,'5100'),6);
    assert.equal(await posted(rest,'1110'),60);
    await check(rest,[meal,cheese]);
    console.log('PASS sector-restaurant PostgreSQL dine-in table, costed modifier ingredients, cash/COGS/WAC/GL');

    // RESTAURANT: a refund for a prepared dish is not a restock. Preserve the
    // consumed meal and ingredient quantities, their historic COGS and WAC,
    // while reversing the cash and revenue in one atomic transaction.
    const returnsBefore=await db.selectFrom('return_documents').select(db.fn.countAll().as('n'))
      .where('tenant_id','=',rest.auth.tenantId!).executeTakeFirstOrThrow();
    const mealBefore=await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',meal).executeTakeFirstOrThrow();
    const processed=await returns.createReturn({type:'sale',invoiceId:rId,
      items:[{productId:meal,qty:1}],settlementMode:'refund',refundMethod:'cash'},rest.auth);
    const refundId=Number(processed.id);
    const refundLine=await db.selectFrom('return_items')
      .select(['qty','cost_price']).where('tenant_id','=',rest.auth.tenantId!)
      .where('return_document_id','=',refundId).executeTakeFirstOrThrow();
    assert.equal(Number(refundLine.qty),1);
    assert.equal(Number(refundLine.cost_price),0,'consumed composite ingredients cannot be restocked in GL');
    const returnsAfter=await db.selectFrom('return_documents').select(db.fn.countAll().as('n'))
      .where('tenant_id','=',rest.auth.tenantId!).executeTakeFirstOrThrow();
    assert.equal(Number(returnsAfter.n),Number(returnsBefore.n)+1);
    assert.equal(await posted(rest,'5100'),6,'original ingredient and prepared meal COGS remain expensed');
    assert.equal(await posted(rest,'1110'),0,'cash payment and cash refund net to zero');
    assert.equal(Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',cheese).executeTakeFirstOrThrow()).stock_qty),1.8);
    assert.equal(Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',meal).executeTakeFirstOrThrow()).stock_qty),Number(mealBefore.stock_qty));
    await check(rest,[meal,cheese]);
    await assert.rejects(returns.createReturn({type:'sale',invoiceId:rId,
      items:[{productId:meal,qty:1}],settlementMode:'refund',refundMethod:'cash'},rest.auth),
      (e:any)=>e.code==='RETURN_QTY_EXCEEDED');
    assert.equal(await posted(rest,'1110'),0,'duplicate prepared dish return does not refund twice');
    console.log('PASS sector-restaurant PostgreSQL prepared meal refund preserves consumed inventory/COGS and reverses cash once');

    // A takeaway order goes through the same costed sale, receipt and GL path.
    // This is deliberately not a claim that physical KDS stations were exercised.
    const takeaway=await checkout(rest,[{productId:meal,name:'Bistro takeaway',
      qty:1,price:60,unitMultiplier:1}],{orderType:'takeaway'});
    assert.ok(Number((takeaway.sale as {id:string}).id)>0);
    assert.equal(Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',meal)
      .executeTakeFirstOrThrow()).stock_qty),0);
    assert.equal(await posted(rest,'5100'),10,'takeaway meal incurs additional historic COGS');
    assert.equal(await posted(rest,'1110'),60,'takeaway cash paid and earlier meal refunded');
    await check(rest,[meal,cheese]);
    console.log('PASS sector-restaurant PostgreSQL takeaway invoice, cost and cash posting');

    // Both following negative checks need a saleable meal, otherwise the
    // generic meal-stock guard masks the modifier spoof / ingredient shortage.
    await receive(rest,meal,1,4);
    // A configured non-stock menu option may not be turned into a physical
    // ingredient expense by providing an arbitrary productId in the POS body.
    const group=await db.insertInto('pos_modifier_groups').values({
      tenant_id:rest.auth.tenantId!,account_id:rest.auth.accountId!,
      name:'No stock group',name_en:null,selection_type:'single',
      is_mandatory:false,min_selections:0,max_selections:1,display_order:1,
      is_active:true,is_splittable_in_half:false,
    } as any).returning('id').executeTakeFirstOrThrow();
    const noStockOption=await db.insertInto('pos_modifier_options').values({
      tenant_id:rest.auth.tenantId!,account_id:rest.auth.accountId!,
      group_id:Number(group.id),name:'No stock note',name_en:null,
      price:0,cost_price:0,component_product_id:null,
      consumption_qty:1,unit_name:null,portion_allowed:'full',
      is_default:false,is_active:true,display_order:1,preparation_time_minutes:0,
    } as any).returning('id').executeTakeFirstOrThrow();
    await assert.rejects(checkout(rest,[{productId:meal,name:'Bistro meal',qty:1,price:60,
      unitMultiplier:1,modifiers:[{optionId:Number(noStockOption.id),productId:cheese,
        name:'spoof',qty:1,price:0,costPrice:999}]}]),
      (e:any)=>e.code==='RESTAURANT_MODIFIER_COMPONENT_MISMATCH');
    assert.equal(await posted(rest,'5100'),10);
    await check(rest,[meal,cheese]);
    console.log('PASS sector-restaurant PostgreSQL non-stock menu option cannot spoof ingredient intake');

    // Missing stock must roll back invoice, tender and GL together.
    const salesBefore=await db.selectFrom('sales').select(db.fn.countAll().as('n'))
      .where('tenant_id','=',rest.auth.tenantId!).executeTakeFirstOrThrow();
    await assert.rejects(checkout(rest,[{productId:meal,name:'Bistro meal',qty:1,price:60,
      unitMultiplier:1,modifiers:[{productId:cheese,name:'Cheese',qty:999,price:0,costPrice:0}]}]));
    const salesAfter=await db.selectFrom('sales').select(db.fn.countAll().as('n'))
      .where('tenant_id','=',rest.auth.tenantId!).executeTakeFirstOrThrow();
    assert.equal(Number(salesAfter.n),Number(salesBefore.n),'rejected recipe ingredient allocation is atomic');
    await check(rest,[meal,cheese]);
    console.log('PASS sector-restaurant PostgreSQL shortage rolls back POS source, tender, stock and GL');

    // R4-C (INV-REST-MODIFIER-CONTRACT-2): a configured option price is
    // server truth — a client-sent 0 must post at the configured 10.
    // At base this posts 60 (client price honoured) and fails below.
    const pricedGroup=await db.insertInto('pos_modifier_groups').values({
      tenant_id:rest.auth.tenantId!,account_id:rest.auth.accountId!,
      name:'Priced extras',name_en:null,selection_type:'multiple',
      is_mandatory:false,min_selections:0,max_selections:10,display_order:2,
      is_active:true,is_splittable_in_half:false,
    } as any).returning('id').executeTakeFirstOrThrow();
    const pricedOption=await db.insertInto('pos_modifier_options').values({
      tenant_id:rest.auth.tenantId!,account_id:rest.auth.accountId!,
      group_id:Number(pricedGroup.id),name:'Extra cheese',name_en:null,
      price:10,cost_price:0,component_product_id:null,
      consumption_qty:1,unit_name:null,portion_allowed:'both',
      is_default:false,is_active:true,display_order:1,preparation_time_minutes:0,
    } as any).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('product_pos_modifiers').values({
      tenant_id:rest.auth.tenantId!,account_id:rest.auth.accountId!,
      product_id:meal,modifier_group_id:Number(pricedGroup.id),
    } as any).execute();
    const repricedSale=await checkout(rest,[{productId:meal,name:'Bistro meal',qty:1,price:60,
      unitMultiplier:1,modifiers:[{optionId:Number(pricedOption.id),productId:0,
        name:'Extra cheese',qty:1,price:0,costPrice:0}]}],
      {payments:[{paymentChannel:'cash',amount:70}]});
    const repricedId=Number((repricedSale.sale as {id:string}).id);
    const repricedLine=await db.selectFrom('sale_items').select(['line_total','modifiers'])
      .where('tenant_id','=',rest.auth.tenantId!).where('sale_id','=',repricedId).executeTakeFirstOrThrow();
    assert.equal(Number(repricedLine.line_total),70,'option priced 10 posts at 60 + 10, not the client-sent 0');
    const repricedMods=typeof repricedLine.modifiers==='string'
      ? JSON.parse(repricedLine.modifiers) : repricedLine.modifiers;
    assert.equal(Number(repricedMods[0].price),10,'stored modifier price is the configured price');
    assert.equal(await posted(rest,'1110'),130,'cash 60 + repriced 70');
    assert.equal(await posted(rest,'5100'),14,'COGS 10 + meal WAC 4');
    assert.equal(Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',meal)
      .executeTakeFirstOrThrow()).stock_qty),0);
    await check(rest,[meal,cheese]);
    console.log('PASS sector-restaurant PostgreSQL configured option price re-prices a spoofed client price');

    // R4-C: a modifier with no server price truth is rejected, never
    // posted as a silent discount. At base both post at 55 (60 - 5).
    const salesBeforeSpoof=await db.selectFrom('sales').select(db.fn.countAll().as('n'))
      .where('tenant_id','=',rest.auth.tenantId!).executeTakeFirstOrThrow();
    await assert.rejects(checkout(rest,[{productId:meal,name:'Bistro meal',qty:1,price:60,
      unitMultiplier:1,modifiers:[{productId:999999,name:'Ghost',qty:1,price:-5,costPrice:0}]}]),
      (e:any)=>e.code==='RESTAURANT_MODIFIER_PRICE_UNVERIFIED');
    await assert.rejects(checkout(rest,[{productId:meal,name:'Bistro meal',qty:1,price:60,
      unitMultiplier:1,modifiers:[{productId:cheese,name:'Cheese',qty:1,price:-5,costPrice:0}]}]),
      (e:any)=>e.code==='RESTAURANT_MODIFIER_PRICE_UNVERIFIED');
    const salesAfterSpoof=await db.selectFrom('sales').select(db.fn.countAll().as('n'))
      .where('tenant_id','=',rest.auth.tenantId!).executeTakeFirstOrThrow();
    assert.equal(Number(salesAfterSpoof.n),Number(salesBeforeSpoof.n),'unverifiable modifier price posts no sale');
    assert.equal(await posted(rest,'1110'),130,'no cash moves on a rejected modifier price');
    await check(rest,[meal,cheese]);
    console.log('PASS sector-restaurant PostgreSQL negative modifier price with no server truth is rejected');

    // R4-C (I52): a combo sale whose sides/drinks are real catalog
    // products deducts their stock and posts their COGS. (The backend
    // path already handles real-product mods; the base failure for I52
    // is the combo modal emitting name-only deltas — see the frontend
    // combo spec. This pins the backend side of the contract.)
    const side=await product(rest,'Combo fries','COMBO-FRIES');
    const drink=await product(rest,'Combo cola','COMBO-COLA');
    await receive(rest,side,2,20);
    await receive(rest,drink,2,8);
    // qty 3 (total 12): the duplicate-bill guard warns on any repeat
    // of a same-supplier total within 30 days — 1x4 would repeat the
    // earlier meal receipt (line 346). Meal WAC stays 4 (stock was 0).
    await receive(rest,meal,3,4);
    const comboSale=await checkout(rest,[{productId:meal,name:'Bistro meal',qty:1,price:60,
      unitMultiplier:1,modifiers:[
        {productId:side,name:'Fries',qty:1,price:60,costPrice:0,isComboComponent:true},
        {productId:drink,name:'Cola',qty:1,price:60,costPrice:0,isComboComponent:true}]}]);
    assert.ok(Number((comboSale.sale as {id:string}).id)>0);
    assert.equal(Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',side)
      .executeTakeFirstOrThrow()).stock_qty),1,'combo side stock deducted');
    assert.equal(Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',drink)
      .executeTakeFirstOrThrow()).stock_qty),1,'combo drink stock deducted');
    assert.equal(await posted(rest,'5100'),46,'COGS 14 + meal 4 + side 20 + drink 8');
    assert.equal(await posted(rest,'1110'),310,'cash 130 + combo 180');
    await check(rest,[meal,cheese,side,drink]);
    console.log('PASS sector-restaurant PostgreSQL combo with real products deducts stock and posts COGS');

    // R4-C (I48): mandatory/min/max group rules are enforced by the
    // server, resolved from the DB option's group. At base every one
    // of these posts (or is rejected for the wrong reason).
    const saucesGroup=await db.insertInto('pos_modifier_groups').values({
      tenant_id:rest.auth.tenantId!,account_id:rest.auth.accountId!,
      name:'Sauces',name_en:null,selection_type:'multiple',
      is_mandatory:true,min_selections:1,max_selections:2,display_order:3,
      is_active:true,is_splittable_in_half:false,
    } as any).returning('id').executeTakeFirstOrThrow();
    const toppingGroup=await db.insertInto('pos_modifier_groups').values({
      tenant_id:rest.auth.tenantId!,account_id:rest.auth.accountId!,
      name:'Toppings',name_en:null,selection_type:'multiple',
      is_mandatory:false,min_selections:2,max_selections:10,display_order:4,
      is_active:true,is_splittable_in_half:false,
    } as any).returning('id').executeTakeFirstOrThrow();
    const sauceOptionIds:number[]=[];
    for (const name of ['Ketchup','Mayo','BBQ']) {
      const row=await db.insertInto('pos_modifier_options').values({
        tenant_id:rest.auth.tenantId!,account_id:rest.auth.accountId!,
        group_id:Number(saucesGroup.id),name,name_en:null,
        price:0,cost_price:0,component_product_id:null,
        consumption_qty:1,unit_name:null,portion_allowed:'both',
        is_default:false,is_active:true,display_order:1,preparation_time_minutes:0,
      } as any).returning('id').executeTakeFirstOrThrow();
      sauceOptionIds.push(Number(row.id));
    }
    const toppingOptionIds:number[]=[];
    for (const name of ['Mushroom','Olives']) {
      const row=await db.insertInto('pos_modifier_options').values({
        tenant_id:rest.auth.tenantId!,account_id:rest.auth.accountId!,
        group_id:Number(toppingGroup.id),name,name_en:null,
        price:0,cost_price:0,component_product_id:null,
        consumption_qty:1,unit_name:null,portion_allowed:'both',
        is_default:false,is_active:true,display_order:1,preparation_time_minutes:0,
      } as any).returning('id').executeTakeFirstOrThrow();
      toppingOptionIds.push(Number(row.id));
    }
    for (const gid of [saucesGroup,toppingGroup]) {
      await db.insertInto('product_pos_modifiers').values({
        tenant_id:rest.auth.tenantId!,account_id:rest.auth.accountId!,
        product_id:meal,modifier_group_id:Number(gid.id),
      } as any).execute();
    }
    // qty 6 (total 24): the duplicate-bill guard warns on any repeat
    // of a same-supplier total within 30 days — 2x4 would repeat the
    // earlier meal receipt (total 8, line 279).
    await receive(rest,meal,6,4);
    const salesBeforeRules=await db.selectFrom('sales').select(db.fn.countAll().as('n'))
      .where('tenant_id','=',rest.auth.tenantId!).executeTakeFirstOrThrow();
    const ruleMeal=()=>({productId:meal,name:'Bistro meal',qty:1,price:60,unitMultiplier:1});
    await assert.rejects(checkout(rest,[{...ruleMeal(),modifiers:[]}]),
      (e:any)=>e.code==='RESTAURANT_MODIFIER_RULE_VIOLATED');
    await assert.rejects(checkout(rest,[{...ruleMeal(),modifiers:sauceOptionIds.map((id)=>(
      {optionId:id,productId:0,name:'sauce',qty:1,price:0,costPrice:0}))}]),
      (e:any)=>e.code==='RESTAURANT_MODIFIER_RULE_VIOLATED');
    await assert.rejects(checkout(rest,[{...ruleMeal(),modifiers:[
      {optionId:toppingOptionIds[0],productId:0,name:'topping',qty:1,price:0,costPrice:0},
      {optionId:sauceOptionIds[0],productId:0,name:'sauce',qty:1,price:0,costPrice:0}]}]),
      (e:any)=>e.code==='RESTAURANT_MODIFIER_RULE_VIOLATED');
    const salesAfterRules=await db.selectFrom('sales').select(db.fn.countAll().as('n'))
      .where('tenant_id','=',rest.auth.tenantId!).executeTakeFirstOrThrow();
    assert.equal(Number(salesAfterRules.n),Number(salesBeforeRules.n),'rule violations post no sale');
    const okSauce=await checkout(rest,[{...ruleMeal(),modifiers:[
      {optionId:sauceOptionIds[0],productId:0,name:'sauce',qty:1,price:0,costPrice:0}]}]);
    assert.ok(Number((okSauce.sale as {id:string}).id)>0,'one mandatory selection posts');
    const okToppings=await checkout(rest,[{...ruleMeal(),modifiers:[
      {optionId:toppingOptionIds[0],productId:0,name:'topping',qty:1,price:0,costPrice:0},
      {optionId:toppingOptionIds[1],productId:0,name:'topping',qty:1,price:0,costPrice:0},
      {optionId:sauceOptionIds[0],productId:0,name:'sauce',qty:1,price:0,costPrice:0}]}]);
    assert.ok(Number((okToppings.sale as {id:string}).id)>0,'min-2 group satisfied with two selections posts');
    assert.equal(await posted(rest,'1110'),430,'cash 310 + 60 + 60');
    assert.equal(await posted(rest,'5100'),54,'COGS 46 + meal 4 + meal 4');
    await check(rest,[meal,cheese,side,drink]);
    console.log('PASS sector-restaurant PostgreSQL mandatory/min/max modifier rules enforced server-side');

    // Unlink the I48 groups again: the mandatory Sauces group must not
    // leak into the later pre-existing restaurant cases, which sell
    // this same meal without modifiers (exactly as at base). The
    // groups/options stay in the DB, just unlinked.
    await db.deleteFrom('product_pos_modifiers')
      .where('tenant_id','=',rest.auth.tenantId!)
      .where('product_id','=',meal)
      .where('modifier_group_id','in',[Number(saucesGroup.id),Number(toppingGroup.id)])
      .execute();

    // REAL BOM: restaurant-only entitlement must produce a menu item from
    // costed ingredients, apply WAC/COGS and rollback shortage atomically.
    const recipe=await shop('recipe',['restaurant']);
    const recipeDish=await product(recipe,'Fresh burger BOM','BOM-DISH');
    const recipeMeat=await product(recipe,'Raw beef kg','BOM-BEEF');
    await receive(recipe,recipeMeat,3,20);
    const bom=await db.insertInto('manufacturing_boms').values({
      tenant_id:recipe.auth.tenantId!,account_id:recipe.auth.accountId!,
      product_id:recipeDish,quantity:1,overhead_cost:0,expected_cost:40,is_active:true,
    } as any).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('manufacturing_bom_lines').values({
      bom_id:Number(bom.id),component_product_id:recipeMeat,quantity:2,
      unit_name:'kg',unit_multiplier:1,waste_percentage:0,expected_cost:40,
    } as any).execute();
    await db.updateTable('products').set({kitchen_station:'grill'} as any)
      .where('tenant_id','=',recipe.auth.tenantId!).where('id','=',recipeDish).execute();
    const bomSale=await checkout(recipe,[{productId:recipeDish,name:'Fresh burger BOM',
      qty:1,price:60,unitMultiplier:1}],{orderType:'dine_in'});
    const bomSaleId=Number((bomSale.sale as {id:string}).id);
    const rawAfter=await db.selectFrom('products').select(['stock_qty','cost_price'])
      .where('tenant_id','=',recipe.auth.tenantId!).where('id','=',recipeMeat).executeTakeFirstOrThrow();
    const dishAfter=await db.selectFrom('products').select(['stock_qty','cost_price'])
      .where('tenant_id','=',recipe.auth.tenantId!).where('id','=',recipeDish).executeTakeFirstOrThrow();
    const bomLine=await db.selectFrom('sale_items').select(['cost_price'])
      .where('tenant_id','=',recipe.auth.tenantId!).where('sale_id','=',bomSaleId).executeTakeFirstOrThrow();
    assert.equal(Number(rawAfter.stock_qty),1,'two real raw units consumed');
    assert.equal(Number(dishAfter.stock_qty),0,'prepared dish sold, not left phantom stock');
    assert.equal(Number(dishAfter.cost_price),40,'finished product WAC equals ingredients');
    assert.equal(Number(bomLine.cost_price),40,'sale line records resulting BOM WAC');

    await kds.setTicketStatus(recipe.auth,bomSaleId,'cooking');
    const grillTicket=(await kds.getActiveTickets(recipe.auth,{station:'grill'})).tickets
      .find(t=>t.id===bomSaleId);
    assert.equal(grillTicket?.items[0]?.station,'grill','configured kitchen station is authoritative');
    assert.equal((await kds.getActiveTickets(recipe.auth,{station:'kitchen'})).tickets
      .some(t=>t.id===bomSaleId),false,'do not deliver the same item to the wrong station');

    const cookedCancelBom = await sales.cancelSale(bomSaleId, 'Already cooked', PASSWORD, recipe.auth);
    assert.equal(cookedCancelBom.ok, true);
    assert.equal(Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',recipe.auth.tenantId!).where('id','=',recipeDish)
      .executeTakeFirstOrThrow()).stock_qty),0,'cooked BOM dish cannot be restocked on cancellation');
    assert.equal((await kds.getActiveTickets(recipe.auth,{station:'grill'})).tickets
      .some(t=>t.id===bomSaleId),false,'cancelled cooked dish removed from active kitchen tickets');
    assert.equal(await posted(recipe,'5100'),40,'actual BOM cost posted as COGS');
    await check(recipe,[recipeDish,recipeMeat]);
    const recipeSalesBefore=await db.selectFrom('sales').select(db.fn.countAll().as('n'))
      .where('tenant_id','=',recipe.auth.tenantId!).executeTakeFirstOrThrow();
    await assert.rejects(checkout(recipe,[{productId:recipeDish,
      name:'Second burger shortage',qty:1,price:60,unitMultiplier:1}],{orderType:'dine_in'}));
    assert.equal(Number((await db.selectFrom('sales').select(db.fn.countAll().as('n'))
      .where('tenant_id','=',recipe.auth.tenantId!).executeTakeFirstOrThrow()).n),Number(recipeSalesBefore.n));
    assert.equal(Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',recipe.auth.tenantId!).where('id','=',recipeMeat).executeTakeFirstOrThrow()).stock_qty),1);
    await check(recipe,[recipeDish,recipeMeat]);
    console.log('PASS restaurant PostgreSQL real BOM recipe consumes ingredients, values COGS/WAC/GL, rejects shortages with rollback');


    // KDS: real PostgreSQL queue, tenant isolation, item/station routing and
    // simultaneous status advances. The second transition must not be lost.
    const restaurantTicket = (await kds.getActiveTickets(rest.auth,{station:'kitchen'}))
      .tickets.find(t => t.id === rId);
    assert.ok(restaurantTicket?.items.length, 'restaurant ticket reaches kitchen station');
    await assert.rejects(kds.setTicketStatus(market.auth,rId,'cooking'));
    await assert.rejects(kds.setTicketStatus(rest.auth,999999999,'ready'));
    await kds.setTicketStatus(rest.auth,rId,'pending');
    const transitions=await Promise.all([
      kds.advanceTicketStatus(rest.auth,rId),
      kds.advanceTicketStatus(rest.auth,rId),
    ]);
    assert.deepEqual(transitions.map(x=>x.newStatus).sort(),['cooking','ready']);
    assert.equal((await kds.getActiveTickets(rest.auth)).tickets.find(t=>t.id===rId)?.status,'ready');
    const itemId=Number((await db.selectFrom('sale_items').select('id')
      .where('tenant_id','=',rest.auth.tenantId!).where('sale_id','=',rId)
      .executeTakeFirstOrThrow()).id);
    await assert.rejects(kds.setItemStatus(rest.auth,rId,itemId+987654,'cooking'));
    await kds.setItemStatus(rest.auth,rId,itemId,'ready');
    console.log('PASS restaurant PostgreSQL KDS item/station, tenant ownership, no ghost tickets and concurrent state advances');

    // Prepared composite sale must never restore consumed components through the
    // generic cancellation journal. Before cooking, normal cancel still restores.
    const cookedSale=await checkout(rest,[{productId:meal,name:'Bistro meal',qty:1,price:60,
      unitMultiplier:1,modifiers:[{productId:cheese,name:'Cheese',qty:0.2,price:0}]}],
      {orderType:'dine_in'});
    const cookedId=Number((cookedSale.sale as {id:string}).id);
    await kds.setTicketStatus(rest.auth,cookedId,'cooking');
    const cookedMealStock=Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',meal).executeTakeFirstOrThrow()).stock_qty);
    const cookedCheeseStock=Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',cheese).executeTakeFirstOrThrow()).stock_qty);
    const cookedCancel = await sales.cancelSale(cookedId, 'Prepared', PASSWORD, rest.auth);
    assert.equal(cookedCancel.ok, true);
    const cookedCancelledRow = await db.selectFrom('sales').select('status').where('tenant_id', '=', rest.auth.tenantId!)
      .where('id', '=', cookedId).executeTakeFirstOrThrow();
    assert.equal(cookedCancelledRow.status, 'cancelled');
    // Prepared cooked meal cancellation does NOT falsely restore consumed raw ingredients to physical inventory
    assert.equal(Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',meal).executeTakeFirstOrThrow()).stock_qty),cookedMealStock);
    assert.equal(Number((await db.selectFrom('products').select('stock_qty')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',cheese).executeTakeFirstOrThrow()).stock_qty),cookedCheeseStock);
    await receive(rest,meal,1,7);
    const prePrep=await checkout(rest,[{productId:meal,name:'Pre-prep meal',qty:1,price:60,
      unitMultiplier:1,modifiers:[{productId:cheese,name:'Cheese',qty:0.1,price:0}]}],
      {orderType:'dine_in'});
    const prePrepId=Number((prePrep.sale as {id:string}).id);
    await sales.cancelSale(prePrepId,'Before preparation',PASSWORD,rest.auth);
    const cancelled=await db.selectFrom('sales').select('status').where('tenant_id','=',rest.auth.tenantId!)
      .where('id','=',prePrepId).executeTakeFirstOrThrow();
    assert.equal(cancelled.status,'cancelled');
    // R4-C: side/drink carry stock from the combo case, so they join
    // the inventory check (GL 1140 covers every stocked product).
    await check(rest,[meal,cheese,side,drink]);
    console.log('PASS restaurant PostgreSQL pre-prep cancellation restores, cooked meal cancellation performs safe financial cancellation without phantom stock');

    // Waste uses existing branch stock and live WAC; a shortage rejects by default (allowPending=false),
    // but permits logging a pending reconciliation incident without negative stock or phantom GL.
    const wasteBefore=await db.selectFrom('restaurant_food_waste_logs').select(db.fn.countAll().as('n'))
      .where('tenant_id','=',rest.auth.tenantId!).executeTakeFirstOrThrow();
    await assert.rejects(waste.logWaste(rest.auth,{
      branchId:rest.branchId,productId:cheese,quantity:999,reason:'spoilage',
    }));
    assert.equal(Number((await db.selectFrom('restaurant_food_waste_logs')
      .select(db.fn.countAll().as('n')).where('tenant_id','=',rest.auth.tenantId!)
      .executeTakeFirstOrThrow()).n),Number(wasteBefore.n));

    // Register pending waste incident when shortage exists with allowPending: true
    const pendingWaste = await waste.logWaste(rest.auth, {
      branchId: rest.branchId, productId: cheese, quantity: 5, reason: 'spoilage', allowPending: true,
    });
    assert.equal(pendingWaste.status, 'pending_reconciliation');
    assert.equal(pendingWaste.journalEntryId, null);
    // Assert no negative stock movement was created for pending waste
    const pendingMovements = await db.selectFrom('stock_movements').select('id')
      .where('reference_type', '=', 'food_waste').where('reference_id', '=', pendingWaste.id)
      .where('tenant_id', '=', rest.auth.tenantId!).execute();
    assert.equal(pendingMovements.length, 0);

    const noWarehouse=await db.insertInto('branches').values({
      tenant_id:rest.auth.tenantId!,account_id:rest.auth.accountId!,
      name:'No kitchen stock',code:`NOWH_${tag}`,
    } as any).returning('id').executeTakeFirstOrThrow();
    await assert.rejects(waste.logWaste(rest.auth,{
      branchId:Number(noWarehouse.id),productId:cheese,quantity:0.1,reason:'expired',
    }));
    const wasteResult=await waste.logWaste(rest.auth,{
      branchId:rest.branchId,productId:cheese,quantity:0.2,reason:'spoilage',
    });
    assert.equal(wasteResult.totalCost,2);
    assert.equal(await posted(rest,'5300'),2);

    // Reconcile pending waste after receiving new cheese stock
    await receive(rest, cheese, 5, 10);
    const reconciled = await waste.reconcilePendingWaste(rest.auth, pendingWaste.id);
    assert.equal(reconciled.ok, true);
    assert.equal(reconciled.status, 'reconciled');
    assert.ok(reconciled.journalEntryId);
    assert.equal(await posted(rest,'5300'),52);

    // R4-C: side/drink carry stock from the combo case (see above).
    await check(rest,[meal,cheese,side,drink]);
    console.log('PASS restaurant PostgreSQL real food waste WAC/stock/GL, pending incident on shortage, and clean reconciliation');

    // COD delivery: driver's proof-of-delivery must not silently settle cash;
    // authorized cashier settles courier cash/fee/GL exactly once.
    await receive(rest,meal,1,9);
    const createdRep=await couriers.create({name:'Acceptance Courier',isActive:true,repType:'delivery'} as any,rest.auth) as any;
    const courier=createdRep.deliveryReps.find((x:any)=>x.name==='Acceptance Courier');
    assert.ok(courier?.id);
    const codSale=await sales.createSale({
      source:'pos',branchId:rest.branchId,locationId:rest.locationId,customerId:rest.customerId,
      paymentType:'credit',paymentChannel:'credit',orderType:'delivery',deliveryRepId:Number(courier.id),
      collectionStatus:'cod',deliveryFee:10,taxRate:0,pricesIncludeTax:false,
      items:[{productId:meal,name:'Courier meal',qty:1,price:60,unitMultiplier:1}],
      payments:[],
    } as any,rest.auth);
    const codId=Number((codSale.sale as {id:string}).id);
    const cashBefore=await posted(rest,'1110');
    await couriers.dispatchOrders(rest.auth,{
      repId:Number(courier.id),saleIds:[codId],
    });
    await couriers.driverSettleOrder(codId,Number(courier.id),rest.auth.tenantId!);
    assert.equal((await db.selectFrom('sales').select('delivery_status')
      .where('tenant_id','=',rest.auth.tenantId!).where('id','=',codId)
      .executeTakeFirstOrThrow()).delivery_status,'delivered');
    assert.equal(await posted(rest,'1110'),cashBefore,'driver proof cannot book cashier cash');
    await assert.rejects(couriers.dispatchOrders(rest.auth,{
      repId:Number(courier.id),saleIds:[codId,prePrepId],
    }), (e:any)=>e.code==='DELIVERY_DISPATCH_FORBIDDEN');
    await couriers.settleOrder(codId,rest.auth);
    assert.equal(await posted(rest,'1110'),cashBefore+60,'COD 70 minus freelance courier fee 10');
    await assert.rejects(couriers.settleOrder(codId,rest.auth),
      (e:any)=>e.code==='ALREADY_SETTLED');
    // R4-C: side/drink carry stock from the combo case (see above).
    await check(rest,[meal,cheese,side,drink]);
    console.log('PASS restaurant PostgreSQL COD courier POD, dispatch rollback, settlement fee/cash/GL once');

    // Provider retries must not produce two kitchen tickets or overwrite progress.
    await aggregators.listAggregators(rest.auth);
    const providerOrder={
      aggregatorCode:'talabat',externalOrderId:`ACCEPT_${tag}`,branchId:rest.branchId,
      subtotal:50,deliveryFee:5,customerName:'Provider test',
      items:[{name:'عصير برتقال',qty:1,unitPrice:50}],
    };
    const [aggA,aggB]=await Promise.all([
      aggregators.ingestOrder(rest.auth,providerOrder),
      aggregators.ingestOrder(rest.auth,providerOrder),
    ]);
    assert.equal(aggA.orderId,aggB.orderId,'retries must return same provider order');
    const providerTicketId=10_000_000+aggA.orderId;
    const beverages=(await kds.getActiveTickets(rest.auth,{station:'beverages'})).tickets;
    assert.equal(beverages.filter(x=>x.id===providerTicketId).length,1,
      'KDS displays a provider order only once in its routed station');
    await assert.rejects(aggregators.ingestOrder(rest.auth,{...providerOrder,subtotal:100}));
    await kds.advanceTicketStatus(rest.auth,providerTicketId);
    assert.equal((await kds.getActiveTickets(rest.auth,{station:'beverages'}))
      .tickets.find(x=>x.id===providerTicketId)?.status,'ready');
    console.log('PASS restaurant PostgreSQL provider webhook retries, deduplicated kitchen station ticket and preserved status');

  } finally {
    await app.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
