package com.snus.counter;

import android.os.Bundle;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.text.SimpleDateFormat;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Экран истории: суммарная статистика + список по дням.
 */
public class HistoryActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_history);

        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle(R.string.title_history);
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        }

        SnusStore store = new SnusStore(this);

        TextView tvTotal = findViewById(R.id.tvTotal);
        TextView tvAvg = findViewById(R.id.tvAvg);
        TextView tvMax = findViewById(R.id.tvMax);

        List<long[]> daily = store.getDailyTotals();
        long grand = 0;
        for (long[] d : daily) grand += d[1];

        tvTotal.setText(getString(R.string.stat_total, grand));
        tvAvg.setText(getString(R.string.stat_avg, store.getAverageDailyTotal()));
        tvMax.setText(getString(R.string.stat_max, store.getMaxDailyTotal()));

        // Новые дни сверху
        Collections.reverse(daily);

        RecyclerView rv = findViewById(R.id.recycler);
        rv.setLayoutManager(new LinearLayoutManager(this));
        rv.setAdapter(new DayAdapter(daily));
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    private static class DayAdapter extends RecyclerView.Adapter<DayAdapter.VH> {

        private final List<long[]> days;
        private final SimpleDateFormat fmt = new SimpleDateFormat("dd.MM.yyyy", Locale.getDefault());

        DayAdapter(List<long[]> days) {
            this.days = days;
        }

        static class VH extends RecyclerView.ViewHolder {
            final TextView date;
            final TextView count;

            VH(android.view.View v) {
                super(v);
                date = v.findViewById(R.id.tvDate);
                count = v.findViewById(R.id.tvCount);
            }
        }

        @Override
        public VH onCreateViewHolder(android.view.ViewGroup parent, int viewType) {
            android.view.View v = android.view.LayoutInflater.from(parent.getContext())
                    .inflate(R.layout.item_day, parent, false);
            return new VH(v);
        }

        @Override
        public void onBindViewHolder(VH holder, int position) {
            long[] d = days.get(position);
            holder.date.setText(fmt.format(new Date(d[0])));
            holder.count.setText(holder.itemView.getContext()
                    .getString(R.string.portions_count, d[1]));
        }

        @Override
        public int getItemCount() {
            return days.size();
        }
    }
}
