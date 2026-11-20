package com.zsystems.poslite;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.util.Log;

import woyou.aidlservice.jiuiv5.IWoyouService;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class SunmiPrinterHelper {
    private static final String TAG = "SunmiPrinterHelper";
    private static final Object PDF_LOCK = new Object();
    private static volatile IWoyouService woyouService = null;
    private static volatile boolean isBound = false;

    private static final ServiceConnection conn = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            try {
                woyouService = IWoyouService.Stub.asInterface(service);
                isBound = true;
                Log.i(TAG, "Successfully bound to Sunmi IWoyouService via AIDL");
                if (woyouService != null) {
                    try {
                        woyouService.printerInit(null);
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                Log.w(TAG, "Sunmi IWoyouService bind failed: " + e.getMessage());
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            woyouService = null;
            isBound = false;
            Log.i(TAG, "Sunmi IWoyouService disconnected");
        }
    };

    public static void init(Context context) {
        if (isBound && woyouService != null) return;
        try {
            Intent intent = new Intent();
            intent.setPackage("woyou.aidlservice.jiuiv5");
            intent.setAction("woyou.aidlservice.jiuiv5.IWoyouService");
            context.getApplicationContext().bindService(intent, conn, Context.BIND_AUTO_CREATE);
            Log.i(TAG, "Requested bindService for woyou.aidlservice.jiuiv5.IWoyouService");
        } catch (Exception e) {
            Log.w(TAG, "init bindService error: " + e.getMessage());
        }
    }

    public static void printReceipt(final double amount, final String currency, final String authCode, final String rrn, final String scheme) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String dateStr = new SimpleDateFormat("yyyy/MM/dd HH:mm:ss", Locale.US).format(new Date());

                StringBuilder sb = new StringBuilder();
                sb.append("\n");
                sb.append("===============================\n");
                sb.append("      Z-SYSTEMS SMART POS      \n");
                sb.append("    ELECTRONIC RECEIPT (EDC)   \n");
                sb.append("===============================\n");
                sb.append("DATE/TIME: ").append(dateStr).append("\n");
                sb.append("TERMINAL : SUNMI-V2PRO-ST\n");
                sb.append("CARD     : **** **** **** 4242\n");
                sb.append("SCHEME   : ").append(scheme != null && !scheme.isEmpty() ? scheme : "MADA / VISA").append("\n");
                sb.append("AUTH CODE: ").append(authCode).append("\n");
                sb.append("RRN      : ").append(rrn).append("\n");
                sb.append("STATUS   : APPROVED (000000)\n");
                sb.append("-------------------------------\n");
                sb.append(String.format(Locale.US, "TOTAL    : %.2f %s\n", amount, currency));
                sb.append("===============================\n");
                sb.append("     THANK YOU - MERCI         \n");
                sb.append("\n\n\n\n");

                printRawText(sb.toString());
            }
        }).start();
    }

    public static void printHtmlInvoice(final String html) {
        if (html == null || html.trim().isEmpty()) return;
        try {
            String plainText;
            if (android.os.Build.VERSION.SDK_INT >= 24) {
                plainText = android.text.Html.fromHtml(html, android.text.Html.FROM_HTML_MODE_LEGACY).toString();
            } else {
                plainText = android.text.Html.fromHtml(html).toString();
            }
            plainText = plainText.replaceAll("\n{3,}", "\n\n").trim();
            printRawText(plainText);
        } catch (Exception e) {
            printRawText(html);
        }
    }

    public static void printRawText(final String text) {
        if (text == null || text.trim().isEmpty()) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                String fullText = text;
                if (!fullText.endsWith("\n\n\n\n")) {
                    fullText = fullText + "\n\n\n\n";
                }

                // Wait briefly if service is in the process of binding
                long waitStart = System.currentTimeMillis();
                while (woyouService == null && (System.currentTimeMillis() - waitStart) < 2500) {
                    try {
                        Thread.sleep(100);
                    } catch (InterruptedException ignored) {}
                }

                // 1. Primary: Sunmi IWoyouService (Full Arabic & UTF-8 vector font rendering)
                if (woyouService != null) {
                    try {
                        woyouService.printerInit(null);
                        try {
                            // ESC E 1: Emphasized (Bold) ON + ESC G 1: Double-strike ON for deep pitch-black thermal print
                            woyouService.sendRAWData(new byte[]{0x1B, 0x45, 0x01, 0x1B, 0x47, 0x01}, null);
                        } catch (Exception ignored) {}
                        woyouService.setFontSize(20.0f, null);

                        String[] lines = fullText.split("\n");
                        String barcodeCandidate = null;

                        for (String rawLine : lines) {
                            String trimmed = rawLine.trim();
                            if (trimmed.isEmpty()) {
                                woyouService.lineWrap(1, null);
                                continue;
                            }

                            // 1. Dividers: ---------------- or ================
                            if (trimmed.matches("^[-=_]{3,}$")) {
                                woyouService.setAlignment(1, null); // Center
                                woyouService.printTextWithFont("--------------------------------\n", null, 18.0f, null);
                                continue;
                            }

                            // 2. Brand Name -> Bold Large Centered
                            if (trimmed.contains("Z-SYSTEMS") || trimmed.contains("Z Systems") || trimmed.contains("7 Systems")) {
                                woyouService.setAlignment(1, null);
                                woyouService.printTextWithFont(trimmed + "\n", null, 26.0f, null);
                                continue;
                            }

                            // 3. Store Address / Phone / Tax Number
                            if (trimmed.startsWith("هاتف:") || trimmed.startsWith("الرقم الضريبي:") ||
                                trimmed.contains("الزهور") || trimmed.contains("الفسطاط") ||
                                trimmed.startsWith("فرع:") || trimmed.startsWith("العنوان:")) {
                                woyouService.setAlignment(1, null);
                                woyouService.printTextWithFont(trimmed + "\n", null, 19.0f, null);
                                continue;
                            }

                            // 4. Thank you note
                            if (trimmed.contains("شكراً لتعاملكم معنا") || trimmed.contains("شكرا لتعاملكم")) {
                                woyouService.setAlignment(1, null);
                                woyouService.printTextWithFont("شكراً لتعاملكم معنا\n", null, 21.0f, null);
                                continue;
                            }

                            // 5. Return policy footer -> Split cleanly to prevent word-breaks
                            if (trimmed.contains("الاحتفاظ") || trimmed.contains("استرجاع") || trimmed.contains("سياسة المتجر")) {
                                woyouService.setAlignment(1, null);
                                woyouService.printTextWithFont("يرجى الاحتفاظ بالفاتورة\n", null, 18.5f, null);
                                woyouService.printTextWithFont("الاستبدال والاسترجاع حسب سياسة المتجر\n", null, 18.5f, null);
                                continue;
                            }

                            // 6. Invoice Metadata (Doc No, Date, Cashier, Customer)
                            if (trimmed.startsWith("إيصال بيع:") || trimmed.startsWith("فاتورة بيع:") ||
                                trimmed.startsWith("التاريخ:") || trimmed.startsWith("الكاشير:") ||
                                trimmed.startsWith("العميل:")) {
                                
                                if (trimmed.startsWith("إيصال بيع:") || trimmed.startsWith("فاتورة بيع:")) {
                                    String[] parts = trimmed.split(":");
                                    if (parts.length > 1) {
                                        String cand = parts[1].trim();
                                        if (!cand.isEmpty() && !cand.equals("—")) {
                                            barcodeCandidate = cand;
                                        }
                                    }
                                }
                                woyouService.setAlignment(0, null);
                                woyouService.printTextWithFont(trimmed + "\n", null, 19.5f, null);
                                continue;
                            }

                            // 7. Table Header (Catch any combination of الصنف / الكمية / السعر / المجموع)
                            if (trimmed.contains("الصنف") || trimmed.contains("بيان الأصناف")) {
                                woyouService.setAlignment(0, null);
                                woyouService.printTextWithFont(formatTwoColumns("الصنف", "المجموع", 26) + "\n", null, 20.0f, null);
                                continue;
                            }

                            // 8. Multi-column rows (Totals, Items, Summary) separated by 2+ spaces
                            String[] cols = trimmed.split("\\s{2,}");
                            if (cols.length >= 2) {
                                String rightText = cols[0].trim();
                                String leftText = cols[cols.length - 1].trim();

                                float rowFont = 20.0f;
                                if (rightText.contains("الإجمالي") || rightText.contains("المجموع الكلي")) {
                                    rowFont = 22.0f;
                                }

                                String formatted = formatTwoColumns(rightText, leftText, 26);
                                woyouService.setAlignment(0, null);
                                woyouService.printTextWithFont(formatted + "\n", null, rowFont, null);
                                continue;
                            }

                            // 9. Normal line (single item name, notes, etc.)
                            woyouService.setAlignment(0, null);
                            woyouService.printTextWithFont(trimmed + "\n", null, 20.5f, null);
                        }

                        // Print barcode if found
                        if (barcodeCandidate != null && !barcodeCandidate.isEmpty()) {
                            try {
                                woyouService.lineWrap(1, null);
                                woyouService.setAlignment(1, null); // Center barcode
                                woyouService.printBarCode(barcodeCandidate, 8, 64, 2, 2, null);
                                woyouService.lineWrap(1, null);
                            } catch (Exception ex) {
                                Log.w(TAG, "printBarCode error: " + ex.getMessage());
                            }
                        }

                        woyouService.lineWrap(3, null);
                        try {
                            woyouService.cutPaper(null);
                        } catch (Exception ignored) {}
                        Log.i(TAG, "printRawText successfully executed via Sunmi IWoyouService");
                        return;
                    } catch (Exception e) {
                        Log.w(TAG, "IWoyouService printText error: " + e.getMessage());
                    }
                }

                // 2. Fallback: Local RAW ESC/POS Socket (Port 9100)
                byte[] rawBytes;
                try {
                    byte[] escInit = new byte[]{0x1B, 0x40}; // ESC @
                    byte[] textBytes = fullText.getBytes("UTF-8");
                    byte[] escCut = new byte[]{0x1D, 0x56, 0x42, 0x00}; // GS V B 0 (cut)
                    rawBytes = new byte[escInit.length + textBytes.length + escCut.length];
                    System.arraycopy(escInit, 0, rawBytes, 0, escInit.length);
                    System.arraycopy(textBytes, 0, rawBytes, escInit.length, textBytes.length);
                    System.arraycopy(escCut, 0, rawBytes, escInit.length + textBytes.length, escCut.length);
                } catch (Exception e) {
                    rawBytes = fullText.getBytes();
                }

                try (Socket printerSocket = new Socket("127.0.0.1", 9100);
                     OutputStream posOut = printerSocket.getOutputStream()) {
                    posOut.write(rawBytes);
                    posOut.flush();
                    Log.i(TAG, "printRawText printed via Port 9100 socket fallback");
                } catch (Exception ignored) {}
            }
        }).start();
    }

    public static void printRawBytes(final byte[] data) {
        if (data == null || data.length == 0) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                long waitStart = System.currentTimeMillis();
                while (woyouService == null && (System.currentTimeMillis() - waitStart) < 2500) {
                    try {
                        Thread.sleep(100);
                    } catch (InterruptedException ignored) {}
                }
                if (woyouService != null) {
                    try {
                        woyouService.sendRAWData(data, null);
                        return;
                    } catch (Exception e) {
                        Log.w(TAG, "sendRAWData error: " + e.getMessage());
                    }
                }
            }
        }).start();
    }

    public static boolean printPdfBytes(final Context context, final byte[] pdfBytes) {
        if (pdfBytes == null || pdfBytes.length == 0) return false;
        new Thread(new Runnable() {
            @Override
            public void run() {
                synchronized (PDF_LOCK) {
                    File tempFile = null;
                    ParcelFileDescriptor pfd = null;
                    PdfRenderer renderer = null;
                    try {
                        long waitStart = System.currentTimeMillis();
                        while (woyouService == null && (System.currentTimeMillis() - waitStart) < 3000) {
                            try {
                                Thread.sleep(100);
                            } catch (InterruptedException ignored) {}
                        }

                        if (woyouService == null) {
                            Log.e(TAG, "Cannot print PDF: woyouService is not bound");
                            return;
                        }

                        tempFile = File.createTempFile("print_", ".pdf", context.getCacheDir());
                        FileOutputStream fos = new FileOutputStream(tempFile);
                        fos.write(pdfBytes);
                        fos.flush();
                        fos.close();

                        pfd = ParcelFileDescriptor.open(tempFile, ParcelFileDescriptor.MODE_READ_ONLY);
                        renderer = new PdfRenderer(pfd);
                        int pageCount = renderer.getPageCount();
                        Log.i(TAG, "Rendering PDF pages: " + pageCount);

                        woyouService.printerInit(null);

                        for (int i = 0; i < pageCount; i++) {
                            PdfRenderer.Page page = renderer.openPage(i);
                            int targetWidth = 384; // 58mm printable width in pixels
                            int targetHeight = (int) ((float) targetWidth / page.getWidth() * page.getHeight());

                            Bitmap bitmap = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888);
                            Canvas canvas = new Canvas(bitmap);
                            canvas.drawColor(Color.WHITE);
                            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT);
                            page.close();

                            // Split tall receipts into strips of max 300px to strictly respect Android 1MB Binder limit
                            int maxStripHeight = 300;
                            if (targetHeight <= maxStripHeight) {
                                woyouService.printBitmap(bitmap, null);
                            } else {
                                for (int y = 0; y < targetHeight; y += maxStripHeight) {
                                    int stripH = Math.min(maxStripHeight, targetHeight - y);
                                    Bitmap strip = Bitmap.createBitmap(bitmap, 0, y, targetWidth, stripH);
                                    woyouService.printBitmap(strip, null);
                                    strip.recycle();
                                }
                            }
                            bitmap.recycle();
                            woyouService.lineWrap(1, null);
                        }

                        woyouService.lineWrap(3, null);
                        try {
                            woyouService.cutPaper(null);
                        } catch (Exception ignored) {}
                        Log.i(TAG, "PDF print completed successfully: " + pageCount + " pages");

                    } catch (Exception e) {
                        Log.e(TAG, "printPdfBytes error: " + e.getMessage(), e);
                    } finally {
                        try {
                            if (renderer != null) renderer.close();
                        } catch (Exception ignored) {}
                        try {
                            if (pfd != null) pfd.close();
                        } catch (Exception ignored) {}
                        if (tempFile != null && tempFile.exists()) {
                            try { tempFile.delete(); } catch (Exception ignored) {}
                        }
                    }
                }
            }
        }).start();
        return true;
    }

    private static String formatTwoColumns(String rightText, String leftText, int targetWidth) {
        if (rightText == null) rightText = "";
        if (leftText == null) leftText = "";
        rightText = rightText.trim();
        leftText = leftText.trim();
        int rLen = rightText.length();
        int lLen = leftText.length();
        int spaces = targetWidth - (rLen + lLen);
        if (spaces < 2) spaces = 2;
        StringBuilder sb = new StringBuilder();
        sb.append(rightText);
        for (int i = 0; i < spaces; i++) {
            sb.append(' ');
        }
        sb.append(leftText);
        return sb.toString();
    }
}
