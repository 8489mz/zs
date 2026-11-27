import { test, expect } from '@playwright/test';

test.describe('POS Performance Profiling', () => {
  test('measures POS UI render time with 100+ items', async ({ page }) => {
    // 1. Navigate to POS
    // Note: This relies on local dev server being up and login state being handled.
    // For local dev, we assume we bypass or login via e2e helper.
    const baseUrl = process.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5173';
    
    // Auto login helper logic (we inject auth or use dev user)
    await page.goto(`${baseUrl}/login`);
    await page.fill('input[name="username"]', 'zs');
    await page.fill('input[name="password"]', '1');
    await page.click('.login-submit-pro-btn');
    
    await page.waitForTimeout(1000); // Wait for login to complete

    // Open Shift first
    await page.goto(`${baseUrl}/#/cash-drawer`);
    await page.waitForSelector('text="فتح وردية"', { timeout: 10000 });
    await page.click('text="فتح وردية"');
    
    // Fill the opening balance form if any, or just submit
    // In CashDrawerFormsPanel, there's a submit button "فتح وردية نقطة البيع"
    await page.waitForSelector('button[type="submit"]:has-text("فتح وردية")', { timeout: 5000 });
    await page.click('button[type="submit"]:has-text("فتح وردية")');
    await page.waitForTimeout(1000); // Wait for shift to open

    await page.goto(`${baseUrl}/#/pos`);
    try {
      await page.waitForSelector('.pos-workspace', { timeout: 10000 });
    } catch (e) {
      await page.screenshot({ path: 'pos-failure.png' });
      throw e;
    }

    console.log('✅ Reached POS page');

    // 2. Add 100 items to the POS Cart sequentially and measure performance
    const renderTimes: number[] = [];
    
    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      
      // Simulate adding a dummy item or clicking the first product 100 times
      // Assuming there's a quick add input or product card
      const searchInput = page.locator('.pos-products-unified-search-field input');
      if (await searchInput.isVisible()) {
        await searchInput.fill(`Item ${i}`);
        await page.keyboard.press('Enter');
      } else {
        // Fallback: click the first product card 100 times
        const firstProduct = page.locator('.pos-group-card').first();
        if (await firstProduct.isVisible()) {
            await firstProduct.click();
        }
      }

      // Wait for cart to update
      await page.waitForFunction(() => {
        const items = document.querySelectorAll('.pos-cart-line-item');
        // or check if total updated
        return items.length > 0;
      });
      
      const duration = Date.now() - start;
      renderTimes.push(duration);
      
      if (i % 25 === 0) {
        console.log(`Added ${i} items. Last render: ${duration}ms`);
      }
    }
    
    const avg = renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length;
    console.log(`\n=== FRONTEND PERFORMANCE ===`);
    console.log(`Average time to add item: ${avg.toFixed(2)}ms`);
    console.log(`Max time to add item: ${Math.max(...renderTimes)}ms`);
    
    // Check if the UI froze (time > 500ms is considered freezing)
    const freezes = renderTimes.filter(t => t > 500);
    console.log(`Freezes (>500ms): ${freezes.length}`);
    
    expect(avg).toBeLessThan(500); // Fail if it's too slow
  });
});
