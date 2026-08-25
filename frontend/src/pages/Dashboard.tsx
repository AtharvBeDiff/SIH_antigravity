import { motion } from 'framer-motion';

export function Dashboard() {
  return (
    <div className="space-y-6">
      <header className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">District Overview</h2>
        <p className="text-slate-500 mt-1">Real-time performance and anomaly detection across constituencies.</p>
      </header>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Works', value: '1,284', change: '+12%', color: 'border-white/10' },
          { label: 'Completed', value: '45.2%', change: '+2.4%', color: 'border-white/10' },
          { label: 'Critical Alerts', value: '18', change: '-4', color: 'border-destructive/30 shadow-[0_0_15px_rgba(239,68,68,0.1)]' },
          { label: 'Expenditure', value: '₹42.5 Cr', change: '85% utilized', color: 'border-white/10' },
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className={`glass-card p-5 rounded-xl border ${stat.color}`}
          >
            <p className="text-sm font-medium text-slate-500">{stat.label}</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-slate-900">{stat.value}</span>
            </div>
            <p className="mt-1 text-xs text-blue-600">{stat.change}</p>
          </motion.div>
        ))}
      </div>

      {/* Placeholder for Charts & Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        <div className="lg:col-span-2 glass-card rounded-xl p-6 h-[400px] flex items-center justify-center border-white/5">
          <p className="text-slate-500">Expenditure Burn Rate Chart (Recharts Integration Pending)</p>
        </div>
        <div className="glass-card rounded-xl p-6 h-[400px] flex items-center justify-center border-white/5">
          <p className="text-slate-500">Active Alerts Feed</p>
        </div>
      </div>
    </div>
  );
}
