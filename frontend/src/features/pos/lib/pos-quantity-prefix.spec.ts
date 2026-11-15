import { describe, expect, it } from 'vitest';
import { parseQuantityPrefixQuery } from './pos-quantity-prefix';

describe('parseQuantityPrefixQuery', () => {
  it('parses empty or regular queries without prefix', () => {
    expect(parseQuantityPrefixQuery('')).toEqual({ hasPrefix: false, quantity: 1, cleanQuery: '' });
    expect(parseQuantityPrefixQuery('6221234567890')).toEqual({ hasPrefix: false, quantity: 1, cleanQuery: '6221234567890' });
    expect(parseQuantityPrefixQuery('اندومي')).toEqual({ hasPrefix: false, quantity: 1, cleanQuery: 'اندومي' });
  });

  it('parses plus prefix "10+barcode"', () => {
    expect(parseQuantityPrefixQuery('10+6221234567890')).toEqual({
      hasPrefix: true,
      quantity: 10,
      cleanQuery: '6221234567890',
    });
    expect(parseQuantityPrefixQuery('10+اندومي')).toEqual({
      hasPrefix: true,
      quantity: 10,
      cleanQuery: 'اندومي',
    });
  });

  it('parses multiplication prefix "10*barcode" and "10xbarcode"', () => {
    expect(parseQuantityPrefixQuery('10*6221234567890')).toEqual({
      hasPrefix: true,
      quantity: 10,
      cleanQuery: '6221234567890',
    });
    expect(parseQuantityPrefixQuery('5xشيبسي')).toEqual({
      hasPrefix: true,
      quantity: 5,
      cleanQuery: 'شيبسي',
    });
  });

  it('parses decimal quantities like "2.5*طماطم"', () => {
    expect(parseQuantityPrefixQuery('2.5*طماطم')).toEqual({
      hasPrefix: true,
      quantity: 2.5,
      cleanQuery: 'طماطم',
    });
  });

  it('parses standalone prefix awaiting barcode scan like "10+" or "10*"', () => {
    expect(parseQuantityPrefixQuery('10+')).toEqual({
      hasPrefix: true,
      quantity: 10,
      cleanQuery: '',
    });
    expect(parseQuantityPrefixQuery('10*')).toEqual({
      hasPrefix: true,
      quantity: 10,
      cleanQuery: '',
    });
  });

  it('parses suffix quantity update commands like "+10" or "*10"', () => {
    expect(parseQuantityPrefixQuery('+10')).toEqual({
      hasPrefix: true,
      quantity: 10,
      cleanQuery: '',
      isSuffixQuantityChange: true,
    });
    expect(parseQuantityPrefixQuery('*5')).toEqual({
      hasPrefix: true,
      quantity: 5,
      cleanQuery: '',
      isSuffixQuantityChange: true,
    });
  });

  it('parses leading-dot decimal quantities like ".25*code"', () => {
    expect(parseQuantityPrefixQuery('.25*code')).toEqual({
      hasPrefix: true,
      quantity: 0.25,
      cleanQuery: 'code',
    });
    expect(parseQuantityPrefixQuery('.5+name')).toEqual({
      hasPrefix: true,
      quantity: 0.5,
      cleanQuery: 'name',
    });
  });

  it('parses standalone leading-dot prefix awaiting scan like ".25*"', () => {
    expect(parseQuantityPrefixQuery('.25*')).toEqual({
      hasPrefix: true,
      quantity: 0.25,
      cleanQuery: '',
    });
  });

  it('parses leading-dot suffix quantity update commands like "*.25" or "+.5"', () => {
    expect(parseQuantityPrefixQuery('*.25')).toEqual({
      hasPrefix: true,
      quantity: 0.25,
      cleanQuery: '',
      isSuffixQuantityChange: true,
    });
    expect(parseQuantityPrefixQuery('+.5')).toEqual({
      hasPrefix: true,
      quantity: 0.5,
      cleanQuery: '',
      isSuffixQuantityChange: true,
    });
  });

  it('exempts scale barcodes from quantity prefix multiplier', () => {
    // Standard EAN-13 variable weight prefix 21
    expect(parseQuantityPrefixQuery('2+210004400250')).toEqual({
      hasPrefix: false,
      quantity: 1,
      cleanQuery: '210004400250',
    });
    // Standard prefix 20
    expect(parseQuantityPrefixQuery('5*2000010050012')).toEqual({
      hasPrefix: false,
      quantity: 1,
      cleanQuery: '2000010050012',
    });
    // Prefix 99
    expect(parseQuantityPrefixQuery('3x991234500100')).toEqual({
      hasPrefix: false,
      quantity: 1,
      cleanQuery: '991234500100',
    });
  });
});
