package com.zsystems.poslite;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "ZSystemsBoot";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : "";
        Log.i(TAG, "Boot event received: " + action);

        Intent serviceIntent = new Intent(context, PrintServerService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
            Log.i(TAG, "PrintServerService started on boot successfully");
        } catch (Exception ex) {
            Log.e(TAG, "Failed to start PrintServerService on boot: " + ex.getMessage());
        }
    }
}
