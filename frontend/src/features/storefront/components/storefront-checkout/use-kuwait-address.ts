import React, { useEffect, useRef, useState } from 'react';
import { assembleKuwaitAddress, cleanArabicText, KUWAIT_POPULAR_AREAS } from './storefront-checkout-helpers';

/**
 * Kuwait structured-address state for the storefront checkout modal.
 * Owns the nine Kuwait address fields, the area-dropdown click-outside
 * behaviour, the filtered area list and the field-change handler that
 * re-assembles the freeform customer address. The facade passes its
 * `setCustomerAddress` setter in; the hook is mounted right after that
 * setter is declared in the facade (it is declared after this block's
 * original position, so the call cannot sit where the block used to be).
 */
export function useKuwaitAddress(setCustomerAddress: React.Dispatch<React.SetStateAction<string>>) {
  const [useKwStructured, setUseKwStructured] = useState(true);
  const [kwArea, setKwArea] = useState('');
  const [showKwAreaDropdown, setShowKwAreaDropdown] = useState(false);
  const kwAreaContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showKwAreaDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (kwAreaContainerRef.current && !kwAreaContainerRef.current.contains(e.target as Node)) {
        setShowKwAreaDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showKwAreaDropdown]);

  const filteredKwAreas = React.useMemo(() => {
    const q = cleanArabicText(kwArea);
    if (!q) return KUWAIT_POPULAR_AREAS;
    return KUWAIT_POPULAR_AREAS.filter((a) => cleanArabicText(a).includes(q));
  }, [kwArea]);
  const [kwBlock, setKwBlock] = useState('');
  const [kwStreet, setKwStreet] = useState('');
  const [kwAvenue, setKwAvenue] = useState('');
  const [kwHouse, setKwHouse] = useState('');
  const [kwApartment, setKwApartment] = useState('');
  const [kwExtra, setKwExtra] = useState('');

  const handleKwFieldChange = (
    field: 'area' | 'block' | 'street' | 'avenue' | 'house' | 'apartment' | 'extra',
    value: string
  ) => {
    const nextArea = field === 'area' ? value : kwArea;
    const nextBlock = field === 'block' ? value : kwBlock;
    const nextStreet = field === 'street' ? value : kwStreet;
    const nextAvenue = field === 'avenue' ? value : kwAvenue;
    const nextHouse = field === 'house' ? value : kwHouse;
    const nextApt = field === 'apartment' ? value : kwApartment;
    const nextExtra = field === 'extra' ? value : kwExtra;

    if (field === 'area') setKwArea(value);
    if (field === 'block') setKwBlock(value);
    if (field === 'street') setKwStreet(value);
    if (field === 'avenue') setKwAvenue(value);
    if (field === 'house') setKwHouse(value);
    if (field === 'apartment') setKwApartment(value);
    if (field === 'extra') setKwExtra(value);

    const fullAddr = assembleKuwaitAddress({
      area: nextArea,
      block: nextBlock,
      street: nextStreet,
      avenue: nextAvenue,
      house: nextHouse,
      apartment: nextApt,
      extra: nextExtra,
    });
    setCustomerAddress(fullAddr);
  };
  return {
    useKwStructured,
    setUseKwStructured,
    kwArea,
    setKwArea,
    showKwAreaDropdown,
    setShowKwAreaDropdown,
    kwAreaContainerRef,
    filteredKwAreas,
    kwBlock,
    setKwBlock,
    kwStreet,
    setKwStreet,
    kwAvenue,
    setKwAvenue,
    kwHouse,
    setKwHouse,
    kwApartment,
    setKwApartment,
    kwExtra,
    setKwExtra,
    handleKwFieldChange,
  };
}
