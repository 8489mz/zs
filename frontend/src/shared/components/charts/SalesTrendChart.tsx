import { useTranslation } from 'react-i18next';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { formatCurrency } from '@/lib/format';

interface SalesTrendChartProps {
  data: Array<{
    name: string;
    sales: number;
    purchases?: number;
  }>;
  height?: number;
}

export function SalesTrendChart({ data, height = 300 }: SalesTrendChartProps) {
  const { t } = useTranslation();
  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        {t('shared.charts.sales_trend_chart.s0', "لا توجد بيانات كافية للرسم البياني")}
      </div>
    );
  }

  return (
    <div className="reports-chart-draw-in" style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart
          key={data.map(d => `${d.name}-${d.sales}-${d.purchases || 0}`).join('_')}
          data={data}
          margin={{
            top: 10,
            right: 10,
            left: 0,
            bottom: 0,
          }}
        >
          <defs>
            <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="colorPurchases" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border, #e2e8f0)" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--text-muted, #64748b)', fontSize: 12 }}
            dy={10}
            // INV-REPORTS-REAL-SALES-PURCHASES-SERIES: a daily series
            // can hold up to 92 labels; thin them instead of overlapping.
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: 'var(--text-muted, #64748b)', fontSize: 12 }}
            tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
            dx={-10}
            width={60}
          />
          <Tooltip 
            formatter={(value: any) => [formatCurrency(value), '']}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            labelStyle={{ color: 'var(--text-muted, #64748b)', fontWeight: 'bold', marginBottom: 4 }}
          />
          <Legend iconType="circle" wrapperStyle={{ paddingTop: 20 }} />
          <Area 
            name="المبيعات"
            type="monotone" 
            dataKey="sales" 
            stroke="#8b5cf6" 
            strokeWidth={3}
            fillOpacity={1} 
            fill="url(#colorSales)" 
            isAnimationActive={true}
            animationDuration={950}
            animationEasing="ease-out"
            animationBegin={0}
          />
          {data.some(d => d.purchases !== undefined) && (
            <Area 
              name="المشتريات"
              type="monotone" 
              dataKey="purchases" 
              stroke="#f43f5e" 
              strokeWidth={3}
              fillOpacity={1} 
              fill="url(#colorPurchases)" 
              isAnimationActive={true}
              animationDuration={950}
              animationEasing="ease-out"
              animationBegin={120}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
