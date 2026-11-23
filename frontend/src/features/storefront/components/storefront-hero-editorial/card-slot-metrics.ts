interface CardSlotMetrics {
  width: number;
  height: number;
  slantLeft: number;
  slantRight: number;
  marginTop: number;
  zIndex: number;
  isHighlighted: boolean;
  titleFontSize: string;
  badgeFontSize: string;
  priceFontSize: string;
  cartBtnSize: number;
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
}

export function getCardSlotMetrics(offset: number): CardSlotMetrics {
  if (offset === 0) {
    return {
      width: 208,
      height: 302,
      slantLeft: 0,
      slantRight: 0,
      marginTop: 0,
      zIndex: 30,
      isHighlighted: true,
      titleFontSize: '11px',
      badgeFontSize: '10.5px',
      priceFontSize: '11px',
      cartBtnSize: 28,
      paddingX: 12,
      paddingTop: 14,
      paddingBottom: 14,
    };
  }

  const abs = Math.abs(offset);
  const isLeft = offset < 0;

  if (abs === 1) {
    const slant = 6;
    return {
      width: 186,
      height: 276,
      slantLeft: isLeft ? slant : 0,
      slantRight: isLeft ? 0 : slant,
      marginTop: 10,
      zIndex: 20,
      isHighlighted: false,
      titleFontSize: '10px',
      badgeFontSize: '10px',
      priceFontSize: '10.5px',
      cartBtnSize: 26,
      paddingX: 10,
      paddingTop: 13,
      paddingBottom: 13,
    };
  }

  if (abs === 2) {
    const slant = 7.5;
    return {
      width: 172,
      height: 256,
      slantLeft: isLeft ? slant : 0,
      slantRight: isLeft ? 0 : slant,
      marginTop: 18,
      zIndex: 12,
      isHighlighted: false,
      titleFontSize: '9.5px',
      badgeFontSize: '9.5px',
      priceFontSize: '10px',
      cartBtnSize: 24,
      paddingX: 9,
      paddingTop: 12,
      paddingBottom: 12,
    };
  }

  const slant = 9;
  return {
    width: 160,
    height: 238,
    slantLeft: isLeft ? slant : 0,
    slantRight: isLeft ? 0 : slant,
    marginTop: 26,
    zIndex: 6,
    isHighlighted: false,
    titleFontSize: '9px',
    badgeFontSize: '9px',
    priceFontSize: '9.5px',
    cartBtnSize: 23,
    paddingX: 8,
    paddingTop: 12,
    paddingBottom: 12,
  };
}
