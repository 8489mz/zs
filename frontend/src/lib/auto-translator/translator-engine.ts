import { ARABIC_CHAR_REGEX, IGNORED_TAGS } from './auto-translator-data';
import { translateUiText } from './translate-ui-text';

// Memory map to store original Arabic text for 100% reversible language switching
const originalTextMap = new WeakMap<Node, string>();
const originalAttrMap = new WeakMap<Element, Record<string, string>>();

let observer: MutationObserver | null = null;
let isTranslating = false;
let pendingNodes: Node[] = [];
let rafId: number | null = null;

function shouldSkipElement(el: Element): boolean {
  if (IGNORED_TAGS.has(el.tagName)) return true;
  if (el.hasAttribute('data-no-translate') || el.getAttribute('translate') === 'no') return true;
  if (
    el.classList.contains('product-name') ||
    el.classList.contains('product-title') ||
    el.classList.contains('item-name') ||
    el.classList.contains('user-content')
  ) {
    return true;
  }
  return false;
}

function processTextNode(node: Text): void {
  const parent = node.parentElement;
  if (!parent || shouldSkipElement(parent) || parent.tagName === 'TEXTAREA') return;

  const currentVal = node.nodeValue;
  if (!currentVal) return;

  const translated = translateUiText(currentVal);
  if (translated && translated !== currentVal) {
    if (!originalTextMap.has(node)) {
      originalTextMap.set(node, currentVal);
    }
    node.nodeValue = translated;
  }
}

function processElementAttributes(el: HTMLElement): void {
  if (shouldSkipElement(el)) return;

  // Placeholder
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) {
    const translated = translateUiText(placeholder);
    if (translated && translated !== placeholder) {
      let saved = originalAttrMap.get(el);
      if (!saved) {
        saved = {};
        originalAttrMap.set(el, saved);
      }
      if (!saved.placeholder) saved.placeholder = placeholder;
      el.setAttribute('placeholder', translated);
    }
  }

  // Title / Tooltip
  const title = el.getAttribute('title');
  if (title) {
    const translated = translateUiText(title);
    if (translated && translated !== title) {
      let saved = originalAttrMap.get(el);
      if (!saved) {
        saved = {};
        originalAttrMap.set(el, saved);
      }
      if (!saved.title) saved.title = title;
      el.setAttribute('title', translated);
    }
  }

  // aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const translated = translateUiText(ariaLabel);
    if (translated && translated !== ariaLabel) {
      let saved = originalAttrMap.get(el);
      if (!saved) {
        saved = {};
        originalAttrMap.set(el, saved);
      }
      if (!saved.ariaLabel) saved.ariaLabel = ariaLabel;
      el.setAttribute('aria-label', translated);
    }
  }

  // Button value: <input type="button" value="حفظ" /> or <input type="submit" value="..." />
  if (el.tagName === 'INPUT') {
    const inputType = el.getAttribute('type');
    if (inputType === 'button' || inputType === 'submit') {
      const val = (el as HTMLInputElement).value;
      if (val) {
        const translated = translateUiText(val);
        if (translated && translated !== val) {
          let saved = originalAttrMap.get(el);
          if (!saved) {
            saved = {};
            originalAttrMap.set(el, saved);
          }
          if (!saved.value) saved.value = val;
          (el as HTMLInputElement).value = translated;
        }
      }
    }
  }
}

function walkAndTranslate(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    processTextNode(root as Text);
    return;
  }

  if (root.nodeType === Node.ELEMENT_NODE) {
    const el = root as HTMLElement;
    if (shouldSkipElement(el)) return;
    processElementAttributes(el);

    if (el.tagName === 'TEXTAREA') return;

    let child = el.firstChild;
    while (child) {
      walkAndTranslate(child);
      child = child.nextSibling;
    }
  }
}

function restoreNodeToOriginal(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    const orig = originalTextMap.get(root);
    if (orig != null) {
      root.nodeValue = orig;
    }
    return;
  }

  if (root.nodeType === Node.ELEMENT_NODE) {
    const el = root as HTMLElement;
    const saved = originalAttrMap.get(el);
    if (saved) {
      if (saved.placeholder != null) el.setAttribute('placeholder', saved.placeholder);
      if (saved.title != null) el.setAttribute('title', saved.title);
    }

    let child = el.firstChild;
    while (child) {
      restoreNodeToOriginal(child);
      child = child.nextSibling;
    }
  }
}

function flushPendingTranslations(): void {
  isTranslating = true;
  const nodes = pendingNodes;
  pendingNodes = [];
  rafId = null;

  for (const node of nodes) {
    if (node.isConnected) {
      walkAndTranslate(node);
    }
  }
  isTranslating = false;
}

function queueNodeForTranslation(node: Node): void {
  pendingNodes.push(node);
  if (rafId === null) {
    rafId = requestAnimationFrame(flushPendingTranslations);
  }
}

let originalDocTitle: string | null = null;

function syncDocumentTitle(): void {
  if (typeof document === 'undefined') return;
  if (document.title && ARABIC_CHAR_REGEX.test(document.title)) {
    const orig = document.title;
    const trans = translateUiText(orig);
    if (trans && trans !== orig) {
      if (!originalDocTitle) originalDocTitle = orig;
      document.title = trans;
    }
  }
}

function handleMutations(mutations: MutationRecord[]): void {
  if (isTranslating) return;

  syncDocumentTitle();
  // Universal Date and Number Prototype Interceptor for English UI
  if (typeof window !== 'undefined' && !(window as any).__zsLocalePatched) {
    (window as any).__zsLocalePatched = true;

    const origDateToLocaleDateString = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = function (this: Date, locales?: any, options?: any) {
      if (document.documentElement.lang?.startsWith('en') && (locales === 'ar-EG' || locales === 'ar')) {
        return origDateToLocaleDateString.call(this, 'en-US', options);
      }
      return origDateToLocaleDateString.call(this, locales, options);
    };

    const origDateToLocaleString = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = function (this: Date, locales?: any, options?: any) {
      if (document.documentElement.lang?.startsWith('en') && (locales === 'ar-EG' || locales === 'ar')) {
        return origDateToLocaleString.call(this, 'en-US', options);
      }
      return origDateToLocaleString.call(this, locales, options);
    };

    const origDateToLocaleTimeString = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function (this: Date, locales?: any, options?: any) {
      if (document.documentElement.lang?.startsWith('en') && (locales === 'ar-EG' || locales === 'ar')) {
        return origDateToLocaleTimeString.call(this, 'en-US', options);
      }
      return origDateToLocaleTimeString.call(this, locales, options);
    };

    const origNumberToLocaleString = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = function (this: number, locales?: any, options?: any) {
      if (document.documentElement.lang?.startsWith('en') && (locales === 'ar-EG' || locales === 'ar')) {
        return origNumberToLocaleString.call(this, 'en-US', options);
      }
      return origNumberToLocaleString.call(this, locales, options);
    };
  }


  for (const mut of mutations) {
    if (mut.type === 'childList') {
      mut.addedNodes.forEach((added) => {
        queueNodeForTranslation(added);
      });
    } else if (mut.type === 'characterData') {
      if (mut.target.nodeType === Node.TEXT_NODE) {
        queueNodeForTranslation(mut.target);
      }
    } else if (mut.type === 'attributes') {
      if (mut.target.nodeType === Node.ELEMENT_NODE) {
        processElementAttributes(mut.target as HTMLElement);
      }
    }
  }
}

export function activateAutoTranslator(): void {
  if (typeof document === 'undefined') return;

  if (document.documentElement.dir !== 'ltr') {
    document.documentElement.dir = 'ltr';
  }
  if (document.documentElement.lang !== 'en') {
    document.documentElement.lang = 'en';
  }

  syncDocumentTitle();

  // Initial full scan
  isTranslating = true;
  walkAndTranslate(document.body);
  isTranslating = false;

  // Observe ongoing dynamic updates (modals, dialogs, lists)
  if (!observer) {
    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'value'],
    });
  }
}

export function deactivateAutoTranslator(): void {
  if (typeof document === 'undefined') return;

  if (document.documentElement.dir !== 'rtl') {
    document.documentElement.dir = 'rtl';
  }
  if (document.documentElement.lang !== 'ar') {
    document.documentElement.lang = 'ar';
  }

  if (originalDocTitle) {
    document.title = originalDocTitle;
    originalDocTitle = null;
  }

  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pendingNodes = [];

  // Restore everything to original Arabic
  restoreNodeToOriginal(document.body);
}

/**
 * Initializes the universal auto-translator listener.
 * Automatically activates when English is active, and deactivates/restores when Arabic is active.
 */
export function initAutoTranslator(i18nInstance: any): void {
  if (typeof window === 'undefined' || !i18nInstance) return;

  const isEnglish = (lang?: string | null) => Boolean(lang && lang.toLowerCase().startsWith('en'));

  const currentLang = i18nInstance.language || 'ar';
  if (isEnglish(currentLang)) {
    // Delay slightly to allow React initial mount to finish
    setTimeout(activateAutoTranslator, 50);
  }

  i18nInstance.on('languageChanged', (lng: string) => {
    if (isEnglish(lng)) {
      activateAutoTranslator();
    } else {
      deactivateAutoTranslator();
    }
  });
}
