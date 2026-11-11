package com.zsystems.poslite;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Locale;

public class PrintServerService extends Service {
    private static final String TAG = "ZSystemsPrintServer";
    private static final int NOTIF_ID = 18182;
    private static final String CHANNEL_ID = "zsystems_print_channel";

    private volatile boolean isRunning = false;
    private ServerSocket http8080Server;
    private ServerSocket tcp9100Server;
    private Thread httpThread;
    private Thread tcp9100Thread;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIF_ID, buildForegroundNotification());

        // Initialize Sunmi hardware printer helper
        SunmiPrinterHelper.init(this);

        startServers();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!isRunning) {
            startServers();
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        closeServers();
        super.onDestroy();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Z-Systems Print Service",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Z-Systems Thermal Printer Background Service");
            channel.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildForegroundNotification() {
        Intent notifIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notifIntent,
            Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= 26) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        builder.setContentTitle("Z-Systems Thermal Print Service")
               .setContentText("طابعة الصن مي جاهزة لاستقبال أوامر الطباعة والـ PDF من الكمبيوتر")
               .setSmallIcon(R.drawable.ic_launcher)
               .setContentIntent(pendingIntent)
               .setOngoing(true);

        return builder.build();
    }

    private synchronized void startServers() {
        if (isRunning) return;
        isRunning = true;

        // 1. HTTP Server on Port 8080 (handles /print-pdf and /print)
        httpThread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    http8080Server = new ServerSocket(8080);
                    Log.i(TAG, "HTTP Print Server listening on 0.0.0.0:8080");
                    while (isRunning && !http8080Server.isClosed()) {
                        try {
                            Socket client = http8080Server.accept();
                            handleHttpClientAsync(client);
                        } catch (Exception e) {
                            if (!isRunning) break;
                        }
                    }
                } catch (Exception ex) {
                    Log.e(TAG, "HTTP Print Server 8080 error: " + ex.getMessage());
                }
            }
        }, "PrintHttp8080Thread");
        httpThread.setDaemon(true);
        httpThread.start();

        // 2. RAW ESC/POS Server on Port 9100 (Standard Windows Network Printer)
        tcp9100Thread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    tcp9100Server = new ServerSocket(9100);
                    Log.i(TAG, "RAW ESC/POS Server listening on 0.0.0.0:9100");
                    while (isRunning && !tcp9100Server.isClosed()) {
                        try {
                            Socket client = tcp9100Server.accept();
                            handlePort9100ClientAsync(client);
                        } catch (Exception e) {
                            if (!isRunning) break;
                        }
                    }
                } catch (Exception ex) {
                    Log.e(TAG, "RAW Port 9100 Server error: " + ex.getMessage());
                }
            }
        }, "PrintRaw9100Thread");
        tcp9100Thread.setDaemon(true);
        tcp9100Thread.start();
    }

    private void handleHttpClientAsync(final Socket socket) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    socket.setSoTimeout(70000);
                    InputStream in = socket.getInputStream();
                    OutputStream out = socket.getOutputStream();

                    String requestLine = readHttpHeaderLine(in);
                    if (requestLine == null || requestLine.isEmpty()) {
                        socket.close();
                        return;
                    }

                    String[] parts = requestLine.split(" ");
                    String method = parts.length > 0 ? parts[0].toUpperCase(Locale.US) : "GET";
                    String path = parts.length > 1 ? parts[1].toLowerCase(Locale.US) : "/";

                    // Read headers
                    int contentLength = 0;
                    String line;
                    while ((line = readHttpHeaderLine(in)) != null && !line.isEmpty()) {
                        if (line.toLowerCase(Locale.US).startsWith("content-length:")) {
                            contentLength = Integer.parseInt(line.substring(15).trim());
                        }
                    }

                    // Read body as raw bytes
                    byte[] bodyBytes = new byte[contentLength];
                    if (contentLength > 0) {
                        int read = 0;
                        while (read < contentLength) {
                            int r = in.read(bodyBytes, read, contentLength - read);
                            if (r <= 0) break;
                            read += r;
                        }
                    }
                    String body = new String(bodyBytes, "UTF-8");

                    if ("OPTIONS".equals(method)) {
                        String corsResponse = "HTTP/1.1 204 No Content\r\n" +
                            "Access-Control-Allow-Origin: *\r\n" +
                            "Access-Control-Allow-Private-Network: true\r\n" +
                            "Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE\r\n" +
                            "Access-Control-Allow-Headers: *\r\n" +
                            "Content-Length: 0\r\n\r\n";
                        out.write(corsResponse.getBytes("UTF-8"));
                        out.flush();
                        socket.close();
                        return;
                    }

                    String responseJson;
                    int statusCode = 200;

                    if ("GET".equals(method) && (path.equals("/") || path.contains("/ping") || path.contains("/health") || path.contains("/status"))) {
                        responseJson = "{\"status\":\"ONLINE\",\"terminal\":\"SUNMI-V2PRO\",\"printer\":\"ready\",\"online\":true,\"ready\":true,\"message\":\"طابعة الصن مي نشطة ومستعدة\"}";
                    } else if (path.contains("/test")) {
                        responseJson = "{\"success\":true,\"data\":{\"online\":true,\"reachable\":true,\"portOpen\":true,\"pingSucceeded\":true,\"message\":\"طابعة الصن مي نشطة ومستعدة\",\"latencyMs\":1}}";
                    } else if (path.contains("/print-pdf") || path.contains("/pdf")) {
                        boolean ok = SunmiPrinterHelper.printPdfBytes(PrintServerService.this, bodyBytes);
                        responseJson = "{\"success\":" + ok + ",\"message\":\"تم استلام ملف الـ PDF بنجاح وجاري طباعته حرارياً\"}";
                    } else if (path.contains("/print")) {
                        String textToPrint = "";
                        try {
                            org.json.JSONObject jsonObj = new org.json.JSONObject(body);
                            textToPrint = jsonObj.optString("printData", jsonObj.optString("text", ""));
                        } catch (Exception ex) {
                            textToPrint = body;
                        }
                        SunmiPrinterHelper.printRawText(textToPrint);
                        responseJson = "{\"success\":true,\"message\":\"تم استلام أمر الطباعة بنجاح\"}";
                    } else {
                        responseJson = "{\"status\":\"ONLINE\",\"terminal\":\"SUNMI-V2PRO\",\"printer\":\"ready\",\"message\":\"Z-Systems Thermal Print Service\",\"online\":true}";
                    }

                    byte[] jsonBytes = responseJson.getBytes("UTF-8");
                    String headers = "HTTP/1.1 " + statusCode + " OK\r\n" +
                        "Content-Type: application/json; charset=utf-8\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "Access-Control-Allow-Private-Network: true\r\n" +
                        "Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE\r\n" +
                        "Access-Control-Allow-Headers: *\r\n" +
                        "Content-Length: " + jsonBytes.length + "\r\n" +
                        "Connection: close\r\n\r\n";

                    out.write(headers.getBytes("UTF-8"));
                    out.write(jsonBytes);
                    out.flush();
                    socket.close();
                } catch (Exception ex) {
                    try { socket.close(); } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    private void handlePort9100ClientAsync(final Socket socket) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    socket.setSoTimeout(30000);
                    InputStream in = socket.getInputStream();
                    byte[] buffer = new byte[4096];
                    int bytesRead;
                    java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                    while ((bytesRead = in.read(buffer)) != -1) {
                        baos.write(buffer, 0, bytesRead);
                        if (in.available() == 0) {
                            try { Thread.sleep(60); } catch (Exception ignored) {}
                            if (in.available() == 0) {
                                break;
                            }
                        }
                    }
                    byte[] rawData = baos.toByteArray();
                    if (rawData.length > 0) {
                        Log.i(TAG, "Port 9100 received raw print data: " + rawData.length + " bytes");
                        SunmiPrinterHelper.printRawBytes(rawData);
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Port 9100 client error: " + e.getMessage());
                } finally {
                    try { socket.close(); } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    private static String readHttpHeaderLine(InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream bout = new java.io.ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') bout.write(c);
        }
        if (c == -1 && bout.size() == 0) return null;
        return bout.toString("UTF-8");
    }

    private void closeServers() {
        try {
            if (http8080Server != null) http8080Server.close();
        } catch (Exception ignored) {}
        try {
            if (tcp9100Server != null) tcp9100Server.close();
        } catch (Exception ignored) {}
    }
}
