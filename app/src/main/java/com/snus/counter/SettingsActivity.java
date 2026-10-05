package com.snus.counter;

import android.app.AlertDialog;
import android.os.Bundle;
import android.text.TextUtils;
import android.widget.EditText;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

/**
 * Настройки: дневной лимит, порций в банке, очистка данных.
 */
public class SettingsActivity extends AppCompatActivity {

    private SnusStore store;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle(R.string.title_settings);
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        }

        store = new SnusStore(this);

        findViewById(R.id.rowLimit).setOnClickListener(v ->
                promptNumber(R.string.dialog_limit_title, store.getDailyLimit(), value -> {
                    store.setDailyLimit(value);
                    refreshLabels();
                }));

        findViewById(R.id.rowPouch).setOnClickListener(v ->
                promptNumber(R.string.dialog_pouch_title, store.getPortionsPerPouch(), value -> {
                    store.setPortionsPerPouch(value);
                    refreshLabels();
                }));

        findViewById(R.id.btnClearToday).setOnClickListener(v ->
                new AlertDialog.Builder(this)
                        .setTitle(R.string.clear_today)
                        .setMessage(R.string.confirm_clear_today)
                        .setPositiveButton(R.string.ok, (d, w) -> {
                            store.clearToday();
                            Toast.makeText(this, R.string.cleared, Toast.LENGTH_SHORT).show();
                        })
                        .setNegativeButton(R.string.cancel, null)
                        .show());

        findViewById(R.id.btnClearAll).setOnClickListener(v ->
                new AlertDialog.Builder(this)
                        .setTitle(R.string.clear_all)
                        .setMessage(R.string.confirm_clear_all)
                        .setPositiveButton(R.string.ok, (d, w) -> {
                            store.clearAll();
                            Toast.makeText(this, R.string.cleared, Toast.LENGTH_SHORT).show();
                        })
                        .setNegativeButton(R.string.cancel, null)
                        .show());

        refreshLabels();
    }

    private void refreshLabels() {
        ((android.widget.TextView) findViewById(R.id.valueLimit))
                .setText(String.valueOf(store.getDailyLimit()));
        ((android.widget.TextView) findViewById(R.id.valuePouch))
                .setText(String.valueOf(store.getPortionsPerPouch()));
    }

    private interface OnNumber {
        void onValue(int value);
    }

    private void promptNumber(int titleRes, int current, OnNumber callback) {
        EditText input = new EditText(this);
        input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        input.setText(String.valueOf(current));
        input.setSelection(input.getText().length());

        new AlertDialog.Builder(this)
                .setTitle(titleRes)
                .setView(input)
                .setPositiveButton(R.string.save, (d, w) -> {
                    String s = input.getText().toString();
                    if (!TextUtils.isEmpty(s)) {
                        try {
                            int v = Integer.parseInt(s.trim());
                            if (v > 0) callback.onValue(v);
                        } catch (NumberFormatException ignored) {
                        }
                    }
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }
}
