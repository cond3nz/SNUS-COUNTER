package com.snus.counter;

import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.progressindicator.LinearProgressIndicator;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Главный экран: большой счётчик "сколько вкинуто сегодня",
 * кнопки +1 / -1, прогресс к дневному лимиту, таймер с последней порции.
 */
public class MainActivity extends AppCompatActivity {

    private SnusStore store;
    private TextView tvCount;
    private TextView tvSubtitle;
    private TextView tvLastUse;
    private TextView tvStreak;
    private TextView tvTodayList;
    private LinearProgressIndicator progress;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            updateLastUseLabel();
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        store = new SnusStore(this);

        tvCount = findViewById(R.id.tvCount);
        tvSubtitle = findViewById(R.id.tvSubtitle);
        tvLastUse = findViewById(R.id.tvLastUse);
        tvStreak = findViewById(R.id.tvStreak);
        tvTodayList = findViewById(R.id.tvTodayList);
        progress = findViewById(R.id.progress);

        Button btnPlus = findViewById(R.id.btnPlus);
        Button btnMinus = findViewById(R.id.btnMinus);
        Button btnCustom = findViewById(R.id.btnCustom);
        ImageButton btnHistory = findViewById(R.id.btnHistory);
        ImageButton btnSettings = findViewById(R.id.btnSettings);
        ImageButton btnWeb = findViewById(R.id.btnWeb);

        btnPlus.setOnClickListener(v -> {
            store.addEntry(1);
            refresh();
        });

        btnMinus.setOnClickListener(v -> {
            if (store.getTodayCount() == 0) {
                Toast.makeText(this, R.string.nothing_to_undo, Toast.LENGTH_SHORT).show();
            } else {
                store.removeLastEntryToday();
                refresh();
            }
        });

        btnCustom.setOnClickListener(v -> showCustomDialog());

        btnHistory.setOnClickListener(v ->
                startActivity(new android.content.Intent(this, HistoryActivity.class)));

        btnSettings.setOnClickListener(v ->
                startActivity(new android.content.Intent(this, SettingsActivity.class)));

        btnWeb.setOnClickListener(v ->
                startActivity(new android.content.Intent(this, WebActivity.class)));
    }

    private void showCustomDialog() {
        EditText input = new EditText(this);
        input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        input.setHint(R.string.hint_portions);

        new AlertDialog.Builder(this)
                .setTitle(R.string.custom_title)
                .setView(input)
                .setPositiveButton(R.string.add, (d, w) -> {
                    String s = input.getText().toString();
                    if (!TextUtils.isEmpty(s)) {
                        try {
                            int n = Integer.parseInt(s.trim());
                            if (n > 0) {
                                store.addEntry(n);
                                refresh();
                            }
                        } catch (NumberFormatException ignored) {
                        }
                    }
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
        handler.post(ticker);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(ticker);
    }

    private void refresh() {
        int today = store.getTodayCount();
        int limit = store.getDailyLimit();

        tvCount.setText(String.valueOf(today));
        tvSubtitle.setText(getString(R.string.of_limit, limit));

        // Прогресс к лимиту
        int max = Math.max(limit, 1);
        progress.setMax(max);
        progress.setProgress(Math.min(today, max));
        if (today > limit) {
            tvCount.setTextColor(getColor(R.color.danger));
        } else if (today == limit) {
            tvCount.setTextColor(getColor(R.color.warning));
        } else {
            tvCount.setTextColor(getColor(R.color.accent));
        }

        // Серия без снюса
        int streak = store.getCleanDaysStreak();
        if (streak > 0) {
            tvStreak.setVisibility(View.VISIBLE);
            tvStreak.setText(getString(R.string.clean_days, streak));
        } else {
            tvStreak.setVisibility(View.GONE);
        }

        updateLastUseLabel();
        refreshTodayList();
    }

    private void updateLastUseLabel() {
        long last = store.getLastUseTimeToday();
        if (last == 0) {
            int streak = store.getCleanDaysStreak();
            if (streak > 0) {
                tvLastUse.setText(getString(R.string.last_use_days_ago, streak));
            } else {
                tvLastUse.setText(R.string.last_use_none);
            }
            return;
        }
        long diff = System.currentTimeMillis() - last;
        if (diff < 0) diff = 0; // защита от «будущих» меток (сбой часов устройства)
        long mins = TimeUnit.MILLISECONDS.toMinutes(diff);
        if (mins < 1) {
            tvLastUse.setText(R.string.last_use_now);
        } else if (mins < 60) {
            tvLastUse.setText(getString(R.string.last_use_min, mins));
        } else {
            long hours = TimeUnit.MILLISECONDS.toHours(diff);
            long remMins = mins - hours * 60;
            tvLastUse.setText(getString(R.string.last_use_hour, hours, remMins));
        }
    }

    private void refreshTodayList() {
        List<SnusStore.Entry> entries = store.getTodayEntries();
        if (entries.isEmpty()) {
            tvTodayList.setText(R.string.today_empty);
            return;
        }
        SimpleDateFormat fmt = new SimpleDateFormat("HH:mm", Locale.getDefault());
        StringBuilder sb = new StringBuilder();
        // Показываем последние записи, самые свежие сверху
        for (int i = entries.size() - 1; i >= 0 && i >= entries.size() - 8; i--) {
            SnusStore.Entry e = entries.get(i);
            sb.append(fmt.format(new Date(e.timestamp)));
            if (e.portions > 1) sb.append("  ×").append(e.portions);
            sb.append('\n');
        }
        if (entries.size() > 8) {
            sb.append("…");
        }
        tvTodayList.setText(sb.toString().trim());
    }
}
