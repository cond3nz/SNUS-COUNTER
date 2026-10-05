package com.snus.counter;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Хранилище записей об использованном снюсе.
 * Каждая запись — это порция (по default 1 никотин-пуч), привязанная к дате.
 */
public class SnusStore {

    public static class Entry {
        public final long timestamp; // миллисекунды
        public final int portions;   // сколько порций в этой записи

        Entry(long timestamp, int portions) {
            this.timestamp = timestamp;
            this.portions = portions;
        }
    }

    private static final String PREFS = "snus_prefs";
    private static final String KEY_ENTRIES = "entries_json";
    private static final String KEY_DAILY_LIMIT = "daily_limit";
    private static final String KEY_PORTIONS_PER_POUCH = "portions_per_pouch";

    private final SharedPreferences prefs;

    public SnusStore(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------- Запись ----------

    public void addEntry(int portions) {
        List<Entry> entries = loadEntries();
        entries.add(new Entry(System.currentTimeMillis(), portions));
        saveEntries(entries);
    }

    public void removeLastEntryToday() {
        String today = dayKey(System.currentTimeMillis());
        List<Entry> entries = loadEntries();
        for (int i = entries.size() - 1; i >= 0; i--) {
            if (dayKey(entries.get(i).timestamp).equals(today)) {
                entries.remove(i);
                break;
            }
        }
        saveEntries(entries);
    }

    public void clearAll() {
        saveEntries(new ArrayList<>());
    }

    public void clearToday() {
        String today = dayKey(System.currentTimeMillis());
        List<Entry> entries = loadEntries();
        entries.removeIf(e -> dayKey(e.timestamp).equals(today));
        saveEntries(entries);
    }

    // ---------- Статистика ----------

    /** Список записей за сегодня */
    public List<Entry> getTodayEntries() {
        String today = dayKey(System.currentTimeMillis());
        List<Entry> result = new ArrayList<>();
        for (Entry e : loadEntries()) {
            if (dayKey(e.timestamp).equals(today)) result.add(e);
        }
        return result;
    }

    /** Сколько порций использовано сегодня */
    public int getTodayCount() {
        int sum = 0;
        for (Entry e : getTodayEntries()) sum += e.portions;
        return sum;
    }

    /** Время последней порции сегодня (мс), 0 если сегодня ничего не было */
    public long getLastUseTimeToday() {
        long last = 0;
        String today = dayKey(System.currentTimeMillis());
        for (Entry e : loadEntries()) {
            if (dayKey(e.timestamp).equals(today) && e.timestamp > last) {
                last = e.timestamp;
            }
        }
        return last;
    }

    /** Дней подряд без использования (сегодня считается нулём, если уже вкинул) */
    public int getCleanDaysStreak() {
        List<Entry> entries = loadEntries();
        if (entries.isEmpty()) return 0;
        long latest = 0;
        for (Entry e : entries) latest = Math.max(latest, e.timestamp);
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 0);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        int days = 0;
        while (cal.getTimeInMillis() < latest) {
            cal.add(Calendar.DAY_OF_YEAR, 1);
            days++;
        }
        return days;
    }

    /** Группировка по дням: [день(мс начала суток), сумма порций] — от старых к новым */
    public List<long[]> getDailyTotals() {
        java.util.TreeMap<String, long[]> map = new java.util.TreeMap<>();
        for (Entry e : loadEntries()) {
            String key = dayKey(e.timestamp);
            long[] v = map.get(key);
            if (v == null) {
                v = new long[]{dayStartMillis(e.timestamp), e.portions};
            } else {
                v[1] += e.portions;
            }
            map.put(key, v);
        }
        return new ArrayList<>(map.values());
    }

    /** Максимум порций за один день за всё время */
    public int getMaxDailyTotal() {
        int max = 0;
        for (long[] d : getDailyTotals()) max = (int) Math.max(max, d[1]);
        return max;
    }

    /** Среднее количество порций в день (по дням, где что-то было) */
    public float getAverageDailyTotal() {
        List<long[]> daily = getDailyTotals();
        if (daily.isEmpty()) return 0f;
        long sum = 0;
        for (long[] d : daily) sum += d[1];
        return (float) sum / daily.size();
    }

    // ---------- Настройки ----------

    public int getDailyLimit() {
        return prefs.getInt(KEY_DAILY_LIMIT, 10);
    }

    public void setDailyLimit(int limit) {
        prefs.edit().putInt(KEY_DAILY_LIMIT, limit).apply();
    }

    public int getPortionsPerPouch() {
        return prefs.getInt(KEY_PORTIONS_PER_POUCH, 20);
    }

    public void setPortionsPerPouch(int p) {
        prefs.edit().putInt(KEY_PORTIONS_PER_POUCH, p).apply();
    }

    /** Примерное кол-во никотина (мг) при указанной крепости — для справки */
    public float getNicotineMg(float mgPerPortion) {
        return getTodayCount() * mgPerPortion;
    }

    // ---------- Утилиты ----------

    private static String dayKey(long ts) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(ts));
    }

    private static long dayStartMillis(long ts) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ts);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    private List<Entry> loadEntries() {
        List<Entry> list = new ArrayList<>();
        String json = prefs.getString(KEY_ENTRIES, "[]");
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                list.add(new Entry(o.getLong("t"), o.getInt("p")));
            }
        } catch (Exception ignored) {
        }
        return list;
    }

    private void saveEntries(List<Entry> entries) {
        JSONArray arr = new JSONArray();
        for (Entry e : entries) {
            JSONObject o = new JSONObject();
            try {
                o.put("t", e.timestamp);
                o.put("p", e.portions);
            } catch (Exception ignored) {
            }
            arr.put(o);
        }
        prefs.edit().putString(KEY_ENTRIES, arr.toString()).apply();
    }
}
