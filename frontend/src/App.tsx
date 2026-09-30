import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import {
  Activity, Trash2, MapPin, Camera, AlertTriangle, CheckCircle, BarChart3,
  Users, Settings, LogOut, Leaf, BrainCircuit, ShieldAlert, CheckCircle2,
  Clock, Map, UploadCloud, ChevronRight, Inbox, CheckSquare, Search, Filter,
  Bell, Menu, X, RotateCcw, Wifi, WifiOff, Radio, Zap, ShieldCheck
} from 'lucide-react';

// --- LIVE API / WEBSOCKET CONFIG ---
const API_BASE = (import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const WS_BASE = API_BASE.replace(/^http/, 'ws');

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function detectWasteImage(blob, filename = 'waste.jpg') {
  const formData = new FormData();
  formData.append('file', blob, filename);
  return apiFetch('/api/waste/detect', { method: 'POST', body: formData });
}

function getBinStatus(fillLevel) {
  if (fillLevel > 80) return 'Critical';
  if (fillLevel > 50) return 'Attention';
  return 'Normal';
}


// --- MOCK DATA ---
const INITIAL_BINS = [
  { id: 'B-101', location: 'Central Market', type: 'Mixed', fillLevel: 92, status: 'Critical', lastUpdated: '10 mins ago', lat: 20, lng: 30 },
  { id: 'B-102', location: 'Central Market', type: 'Recyclable', fillLevel: 45, status: 'Normal', lastUpdated: '15 mins ago', lat: 22, lng: 35 },
  { id: 'B-201', location: 'Bus Stand', type: 'Mixed', fillLevel: 85, status: 'Critical', lastUpdated: '5 mins ago', lat: 70, lng: 20 },
  { id: 'B-202', location: 'Bus Stand', type: 'Wet', fillLevel: 60, status: 'Attention', lastUpdated: '20 mins ago', lat: 75, lng: 25 },
  { id: 'B-301', location: 'Railway Station', type: 'Mixed', fillLevel: 98, status: 'Critical', lastUpdated: '2 mins ago', lat: 80, lng: 80 },
  { id: 'B-401', location: 'College Road', type: 'Recyclable', fillLevel: 30, status: 'Normal', lastUpdated: '1 hour ago', lat: 40, lng: 70 },
  { id: 'B-501', location: 'Food Street', type: 'Wet', fillLevel: 75, status: 'Attention', lastUpdated: '30 mins ago', lat: 50, lng: 50 },
  { id: 'B-502', location: 'Food Street', type: 'Dry', fillLevel: 40, status: 'Normal', lastUpdated: '45 mins ago', lat: 55, lng: 55 },
  { id: 'B-601', location: 'Municipal Park', type: 'Mixed', fillLevel: 10, status: 'Normal', lastUpdated: '2 hours ago', lat: 10, lng: 80 },
  { id: 'B-701', location: 'Main Road', type: 'Dry', fillLevel: 65, status: 'Attention', lastUpdated: '25 mins ago', lat: 60, lng: 40 },
];

const INITIAL_ISSUES = [
  { id: 'GS-1001', location: 'Central Market', type: 'Overflowing Bin', severity: 'High', status: 'Pending', reportedAt: '2023-10-27T08:30', score: 94 },
  { id: 'GS-1002', location: 'Bus Stand', type: 'Garbage Dump', severity: 'High', status: 'Assigned', reportedAt: '2023-10-27T09:15', score: 88, assignedTo: 'Team Alpha' },
  { id: 'GS-1003', location: 'Food Street', type: 'Mixed Waste', severity: 'Medium', status: 'In Progress', reportedAt: '2023-10-27T10:00', score: 72, assignedTo: 'Team Beta' },
  { id: 'GS-1004', location: 'Railway Station', type: 'Unclean Public Area', severity: 'Critical', status: 'Pending', reportedAt: '2023-10-27T11:45', score: 98 },
];

const CHART_DATA = {
  wasteTrends: [
    { name: 'Mon', organic: 4000, plastic: 2400, mixed: 2400 },
    { name: 'Tue', organic: 3000, plastic: 1398, mixed: 2210 },
    { name: 'Wed', organic: 2000, plastic: 9800, mixed: 2290 },
    { name: 'Thu', organic: 2780, plastic: 3908, mixed: 2000 },
    { name: 'Fri', organic: 1890, plastic: 4800, mixed: 2181 },
    { name: 'Sat', organic: 2390, plastic: 3800, mixed: 2500 },
    { name: 'Sun', organic: 3490, plastic: 4300, mixed: 2100 },
  ],
  composition: [
    { name: 'Organic', value: 45, color: '#10b981' },
    { name: 'Plastic', value: 25, color: '#3b82f6' },
    { name: 'Paper/Cardboard', value: 15, color: '#f59e0b' },
    { name: 'Glass/Metal', value: 10, color: '#6366f1' },
    { name: 'Other', value: 5, color: '#94a3b8' },
  ]
};

const AppContext = React.createContext();

export default function App() {
  const [userRole, setUserRole] = useState(null); // 'citizen', 'worker', 'authority'
  const [currentView, setCurrentView] = useState('overview');
  const [bins, setBins] = useState(INITIAL_BINS);
  const [issues, setIssues] = useState(INITIAL_ISSUES);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  useEffect(() => {
    let eventsSocket;
    let binsSocket;
    let reconnectTimer;
    let stopped = false;

    const loadServerState = async () => {
      try {
        const [serverIssues, serverBins] = await Promise.all([
          apiFetch('/api/sanitation/issues'),
          apiFetch('/api/bins')
        ]);
        setIssues(serverIssues);
        setBins(serverBins);
        setConnectionStatus('connected');
      } catch (error) {
        console.warn('GreenSync backend unavailable; using local demo state.', error);
        setConnectionStatus('offline-demo');
      }
    };

    const connectSockets = () => {
      if (stopped) return;

      eventsSocket = new WebSocket(`${WS_BASE}/ws/events`);
      binsSocket = new WebSocket(`${WS_BASE}/ws/bins`);

      const markConnected = () => setConnectionStatus('connected');

      eventsSocket.onopen = markConnected;
      binsSocket.onopen = markConnected;

      eventsSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'issue.created' && message.issue) {
            setIssues(prev => [message.issue, ...prev.filter(i => i.id !== message.issue.id)]);
          }

          if (message.type === 'task.updated' && message.task) {
            setIssues(prev => prev.map(issue =>
              issue.id === message.task.id
                ? { ...issue, ...message.task }
                : issue
            ));
          }

          if (message.type === 'demo.reset') {
            Promise.all([apiFetch('/api/sanitation/issues'), apiFetch('/api/bins')])
              .then(([serverIssues, serverBins]) => {
                setIssues(serverIssues);
                setBins(serverBins);
              })
              .catch(() => {});
          }
        } catch (error) {
          console.warn('Invalid event message', error);
        }
      };

      binsSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type !== 'bin.telemetry' || !message.bin) return;

          setBins(prev => {
            const existing = prev.find(b => b.id === message.bin.id);
            if (!existing) return [message.bin, ...prev];
            return prev.map(b => b.id === message.bin.id ? { ...b, ...message.bin } : b);
          });
        } catch (error) {
          console.warn('Invalid bin telemetry', error);
        }
      };

      const scheduleReconnect = () => {
        setConnectionStatus('reconnecting');
        if (!stopped) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connectSockets, 3000);
        }
      };

      eventsSocket.onclose = scheduleReconnect;
      binsSocket.onclose = scheduleReconnect;
      eventsSocket.onerror = scheduleReconnect;
      binsSocket.onerror = scheduleReconnect;
    };

    loadServerState().finally(connectSockets);

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      eventsSocket?.close();
      binsSocket?.close();
    };
  }, []);

  const reportIssue = async (newIssue) => {
    // Optimistic update keeps the UI responsive before the WebSocket echo arrives.
    const optimistic = {
      ...newIssue,
      id: `GS-${Math.floor(1000 + Math.random() * 9000)}`,
      status: 'Pending',
      reportedAt: new Date().toISOString()
    };
    setIssues(prev => [optimistic, ...prev]);

    try {
      const saved = await apiFetch('/api/sanitation/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newIssue)
      });
      setIssues(prev => [saved, ...prev.filter(issue => issue.id !== optimistic.id && issue.id !== saved.id)]);
      return saved;
    } catch (error) {
      console.warn('Report API failed; local report retained.', error);
      return optimistic;
    }
  };

  const updateIssueStatus = async (id, newStatus, assignedTo = null) => {
    const patch = {
      status: newStatus,
      ...(assignedTo ? { assignedTo } : {})
    };

    // Optimistic UI update.
    setIssues(prev => prev.map(issue =>
      issue.id === id ? { ...issue, ...patch } : issue
    ));

    try {
      const updated = await apiFetch(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });

      setIssues(prev => prev.map(issue => issue.id === id ? { ...issue, ...updated } : issue));
      return updated;
    } catch (error) {
      console.warn('Task API failed; optimistic state retained.', error);
      return null;
    }
  };

  const resetDemo = async () => {
    const data = await apiFetch('/api/demo/reset', { method: 'POST' });
    setIssues(data.issues);
    setBins(data.bins);
    setConnectionStatus('connected');
    return data;
  };

  const stats = useMemo(() => {
    const totalBins = bins.length;
    const criticalBins = bins.filter(b => b.fillLevel > 80).length;
    const activeIssues = issues.filter(i => i.status !== 'Resolved').length;
    const resolvedToday = issues.filter(i => {
      if (i.status !== 'Resolved') return false;
      const resolved = i.resolvedAt ? new Date(i.resolvedAt) : null;
      const now = new Date();
      return resolved
        ? resolved.toDateString() === now.toDateString()
        : true;
    }).length;
    const avgScore = issues.length > 0
      ? Math.round(issues.reduce((acc, curr) => acc + (Number(curr.score) || 0), 0) / issues.length)
      : 0;

    return { totalBins, criticalBins, activeIssues, resolvedToday, avgScore };
  }, [bins, issues]);

  const contextValue = {
    userRole, setUserRole,
    currentView, setCurrentView,
    bins, setBins,
    issues, setIssues,
    reportIssue, updateIssueStatus, resetDemo,
    stats,
    connectionStatus
  };

  if (!userRole) return <LandingPage onSelectRole={setUserRole} />;

  return (
    <AppContext.Provider value={contextValue}>
      <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
        <Sidebar isOpen={isMobileMenuOpen} setIsOpen={setIsMobileMenuOpen} />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <TopHeader onMenuClick={() => setIsMobileMenuOpen(true)} />

          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto space-y-6">
              {currentView === 'overview' && <AuthorityDashboard />}
              {currentView === 'ai-waste' && <AIWasteDetection />}
              {currentView === 'smart-bins' && <SmartBins />}
              {currentView === 'sanitation' && <SanitationMonitoring />}
              {currentView === 'report' && <CitizenReport />}
              {currentView === 'action-center' && <ActionCenter />}
              {currentView === 'worker-tasks' && <WorkerDashboard />}
              {currentView === 'analytics' && <AnalyticsDashboard />}
              {currentView === 'intelligence' && <AIInsights />}
            </div>
          </main>
        </div>
      </div>
    </AppContext.Provider>
  );
}

function LandingPage({ onSelectRole }) {
  return (
    <div className="min-h-screen bg-white">
      {/* Navbar */}
      <nav className="container mx-auto px-6 py-4 flex justify-between items-center border-b border-gray-100">
        <div className="flex items-center gap-2 text-emerald-600 font-bold text-2xl">
          <Leaf className="w-8 h-8" />
          <span>GreenSync</span>
        </div>
        <div className="hidden md:flex gap-6 text-slate-600 font-medium">
          <a href="#" className="hover:text-emerald-600 transition-colors">Features</a>
          <a href="#" className="hover:text-emerald-600 transition-colors">Technology</a>
          <a href="#" className="hover:text-emerald-600 transition-colors">Impact</a>
        </div>
      </nav>

      {/* Hero */}
      <div className="container mx-auto px-6 py-16 md:py-24 text-center">
        <h1 className="text-5xl md:text-6xl font-extrabold text-slate-900 tracking-tight mb-6">
          Smarter Waste. <span className="text-emerald-600">Cleaner Cities.</span>
        </h1>
        <div className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold tracking-wide uppercase">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Live Demo Platform
        </div>
        <p className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto mb-8">
          AI waste classification, citizen reporting, priority scoring, worker dispatch, and real-time smart-bin monitoring in one connected sanitation command platform.
        </p>
        <div className="flex flex-wrap justify-center gap-2 mb-12 text-xs font-semibold text-slate-500">
          {['React', 'FastAPI', 'WebSockets', 'YOLO / OpenCV', 'IoT Simulator'].map(label => (
            <span key={label} className="px-2.5 py-1 rounded-full border border-slate-200 bg-white">{label}</span>
          ))}
        </div>

        {/* Visual Flow Concept */}
        <div className="flex flex-wrap justify-center items-center gap-2 md:gap-4 mb-16 text-sm md:text-base font-semibold text-slate-500">
          <span className="flex items-center gap-1 bg-slate-100 px-3 py-1.5 rounded-full"><Camera className="w-4 h-4 text-emerald-500"/> Detect</span>
          <ChevronRight className="w-4 h-4 text-slate-300 hidden md:block" />
          <span className="flex items-center gap-1 bg-slate-100 px-3 py-1.5 rounded-full"><BrainCircuit className="w-4 h-4 text-emerald-500"/> Classify</span>
          <ChevronRight className="w-4 h-4 text-slate-300 hidden md:block" />
          <span className="flex items-center gap-1 bg-slate-100 px-3 py-1.5 rounded-full"><Activity className="w-4 h-4 text-emerald-500"/> Assess</span>
          <ChevronRight className="w-4 h-4 text-slate-300 hidden md:block" />
          <span className="flex items-center gap-1 bg-slate-100 px-3 py-1.5 rounded-full"><AlertTriangle className="w-4 h-4 text-emerald-500"/> Prioritize</span>
          <ChevronRight className="w-4 h-4 text-slate-300 hidden md:block" />
          <span className="flex items-center gap-1 bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-full"><CheckCircle2 className="w-4 h-4"/> Act</span>
        </div>

        <h2 className="text-2xl font-bold mb-8 text-slate-800">Select your portal to continue</h2>
        
        {/* Role Cards */}
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          <RoleCard 
            title="Citizen Portal" 
            desc="Report waste issues and check AI segregation guides."
            icon={<Users className="w-8 h-8 text-blue-500" />}
            onClick={() => onSelectRole('citizen')}
            hoverColor="hover:border-blue-300 hover:shadow-blue-100"
          />
          <RoleCard 
            title="Sanitation Worker" 
            desc="View assigned tasks, locations, and update statuses."
            icon={<CheckSquare className="w-8 h-8 text-orange-500" />}
            onClick={() => onSelectRole('worker')}
            hoverColor="hover:border-orange-300 hover:shadow-orange-100"
          />
          <RoleCard 
            title="Municipal Authority" 
            desc="Command center for AI insights, bin monitoring, and delegation."
            icon={<ShieldAlert className="w-8 h-8 text-emerald-500" />}
            onClick={() => onSelectRole('authority')}
            hoverColor="hover:border-emerald-300 hover:shadow-emerald-100"
            highlight
          />
        </div>
      </div>
      
      {/* Footer */}
      <footer className="bg-slate-50 border-t border-slate-200 py-8 text-center text-slate-500 mt-12">
        <p className="font-medium">GreenSync • Built for Smart India Hackathon Prototype</p>
      </footer>
    </div>
  );
}

function RoleCard({ title, desc, icon, onClick, hoverColor, highlight }) {
  return (
    <button 
      onClick={onClick}
      className={`text-left p-6 rounded-2xl border-2 transition-all duration-300 bg-white group shadow-sm hover:shadow-md
        ${highlight ? 'border-emerald-200 shadow-emerald-50/50' : 'border-slate-100'} ${hoverColor} flex flex-col h-full`}
    >
      <div className="mb-4 bg-slate-50 p-4 rounded-xl inline-block group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-slate-800 mb-2">{title}</h3>
      <p className="text-slate-600 flex-1">{desc}</p>
      <div className="mt-6 flex items-center text-sm font-semibold text-slate-900 group-hover:text-emerald-600 transition-colors">
        Enter Portal <ChevronRight className="w-4 h-4 ml-1" />
      </div>
    </button>
  );
}

function Sidebar({ isOpen, setIsOpen }) {
  const { userRole, currentView, setCurrentView } = React.useContext(AppContext);

  const citizenNav = [
    { id: 'report', label: 'Report Issue', icon: AlertTriangle },
    { id: 'ai-waste', label: 'AI Waste Check', icon: BrainCircuit },
  ];

  const workerNav = [
    { id: 'worker-tasks', label: 'My Tasks', icon: Inbox },
    { id: 'ai-waste', label: 'AI Waste Check', icon: BrainCircuit },
  ];

  const authorityNav = [
    { id: 'overview', label: 'Command Center', icon: Activity },
    { id: 'action-center', label: 'Action Center', icon: ShieldAlert },
    { id: 'smart-bins', label: 'Smart Bins', icon: Trash2 },
    { id: 'sanitation', label: 'Sanitation Monitor', icon: Camera },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'intelligence', label: 'AI Insights', icon: BrainCircuit },
  ];

  const navItems = userRole === 'citizen' ? citizenNav : userRole === 'worker' ? workerNav : authorityNav;

  // Ensure default view matches role
  useEffect(() => {
    if (userRole === 'citizen' && !citizenNav.find(n => n.id === currentView)) setCurrentView('report');
    if (userRole === 'worker' && !workerNav.find(n => n.id === currentView)) setCurrentView('worker-tasks');
    if (userRole === 'authority' && currentView === 'report') setCurrentView('overview');
  }, [userRole]);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && <div className="fixed inset-0 bg-slate-900/50 z-20 md:hidden" onClick={() => setIsOpen(false)} />}
      
      <aside className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-slate-200 transform transition-transform duration-200 ease-in-out flex flex-col
        ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0
      `}>
        <div className="p-6 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2 text-emerald-600 font-bold text-xl">
            <Leaf className="w-6 h-6" /> GreenSync
          </div>
          <button className="md:hidden text-slate-400 hover:text-slate-600" onClick={() => setIsOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {userRole} Menu
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => { setCurrentView(item.id); setIsOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors
                ${currentView === item.id 
                  ? 'bg-emerald-50 text-emerald-700' 
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
            >
              <item.icon className={`w-5 h-5 ${currentView === item.id ? 'text-emerald-600' : 'text-slate-400'}`} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <button 
            onClick={() => window.location.reload()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-5 h-5 text-slate-400 group-hover:text-red-500" />
            Switch Role
          </button>
        </div>
      </aside>
    </>
  );
}

function TopHeader({ onMenuClick }) {
  const { userRole, connectionStatus, resetDemo } = React.useContext(AppContext);
  const [resetting, setResetting] = useState(false);

  const reset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      await resetDemo();
    } catch (error) {
      console.warn('Could not reset demo state', error);
    } finally {
      setResetting(false);
    }
  };

  const live = connectionStatus === 'connected';
  const reconnecting = connectionStatus === 'reconnecting';

  return (
    <header className="bg-white/95 backdrop-blur border-b border-slate-200 sticky top-0 z-10 px-4 sm:px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <button className="md:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-lg" onClick={onMenuClick}>
          <Menu className="w-5 h-5" />
        </button>
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-sm font-semibold bg-slate-100 px-3 py-1.5 rounded-full text-slate-600 capitalize">
            {userRole} portal
          </span>
          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-full ${
            live ? 'bg-emerald-50 text-emerald-700' : reconnecting ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {live ? <Wifi className="w-3.5 h-3.5" /> : reconnecting ? <Radio className="w-3.5 h-3.5 animate-pulse" /> : <WifiOff className="w-3.5 h-3.5" />}
            {live ? 'Live connected' : reconnecting ? 'Reconnecting' : 'Demo offline'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {userRole === 'authority' && (
          <button
            onClick={reset}
            disabled={resetting}
            className="hidden sm:inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
            title="Reset seeded demo state"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${resetting ? 'animate-spin' : ''}`} />
            {resetting ? 'Resetting…' : 'Reset Demo'}
          </button>
        )}
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-500" /> Local secure demo
        </div>
        <button className="relative p-2 text-slate-400 hover:text-slate-600 transition-colors">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
        </button>
        <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold border border-emerald-200">
          {userRole.charAt(0).toUpperCase()}
        </div>
      </div>
    </header>
  );
}

function KPICard({ title, value, icon: Icon, trend, trendLabel, colorClass = "text-emerald-600", bgClass = "bg-emerald-50" }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm flex flex-col">
      <div className="flex justify-between items-start mb-4">
        <div className={`p-3 rounded-xl ${bgClass} ${colorClass}`}>
          <Icon className="w-6 h-6" />
        </div>
        {trend && (
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${trend > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <h3 className="text-slate-500 text-sm font-medium mb-1">{title}</h3>
      <div className="text-3xl font-bold text-slate-800">{value}</div>
      {trendLabel && <p className="text-xs text-slate-400 mt-2">{trendLabel}</p>}
    </div>
  );
}

function AuthorityDashboard() {
  const { stats, issues, bins } = React.useContext(AppContext);

  // Simple mock map points
  const mapPoints = bins.map(b => ({
    x: b.lng, y: b.lat,
    color: b.fillLevel > 80 ? 'bg-red-500' : b.fillLevel > 50 ? 'bg-yellow-400' : 'bg-emerald-500',
    pulse: b.fillLevel > 80,
    label: b.location
  }));

  const highPriority = issues.filter(i => i.status !== 'Resolved' && (i.score || 0) >= 80).slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Command Center</h1>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold uppercase tracking-wide">
            <Zap className="w-3 h-3" /> Live operations
          </span>
        </div>
        <p className="text-slate-500">One view for citizen reports, workforce status, and smart-bin capacity.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Total Smart Bins" value={stats.totalBins} icon={Trash2} colorClass="text-blue-600" bgClass="bg-blue-50" />
        <KPICard title="Bins Requiring Attention" value={stats.criticalBins} icon={AlertTriangle} trend={12} colorClass="text-orange-600" bgClass="bg-orange-50" />
        <KPICard title="Active Sanitation Issues" value={stats.activeIssues} icon={Activity} trend={-5} colorClass="text-red-600" bgClass="bg-red-50" />
        <KPICard title="Resolved Today" value={stats.resolvedToday} icon={CheckCircle} colorClass="text-emerald-600" bgClass="bg-emerald-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Map Mockup */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2"><Map className="w-5 h-5 text-emerald-500"/> Live Sanitation Map</h3>
            <span className="flex items-center gap-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Live
            </span>
          </div>
          <div className="flex-1 bg-slate-50 rounded-xl border border-slate-200 relative overflow-hidden min-h-[300px] flex items-center justify-center">
            {/* Grid pattern */}
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
            
            {/* Map Points */}
            {mapPoints.map((pt, i) => (
              <div key={i} className="absolute group cursor-pointer" style={{ left: `${pt.x}%`, top: `${pt.y}%`, transform: 'translate(-50%, -50%)' }}>
                {pt.pulse && <div className={`absolute inset-0 ${pt.color} rounded-full animate-ping opacity-75`}></div>}
                <div className={`relative w-4 h-4 rounded-full ${pt.color} border-2 border-white shadow-md z-10`}></div>
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max px-3 py-1.5 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none">
                  {pt.label}
                </div>
              </div>
            ))}
            <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur px-3 py-2 rounded-lg shadow-sm border border-slate-100 text-[10px] font-medium flex gap-3">
              <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Normal</span>
              <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-400"></div> Attention</span>
              <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div> Critical</span>
            </div>
          </div>
        </div>

        {/* Priority Alerts */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col">
          <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Bell className="w-5 h-5 text-red-500"/> Priority Alerts</h3>
          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            {highPriority.length > 0 ? highPriority.map(issue => (
              <div key={issue.id} className="p-4 rounded-xl border border-red-100 bg-red-50/50">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded uppercase">High Priority</span>
                  <span className="text-xs text-slate-500">{new Date(issue.reportedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <h4 className="font-semibold text-slate-800 text-sm mt-2">{issue.type}</h4>
                <p className="text-sm text-slate-600 flex items-center gap-1 mt-1"><MapPin className="w-3 h-3"/> {issue.location}</p>
              </div>
            )) : (
              <div className="text-center py-8 text-slate-400 flex flex-col items-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mb-2" />
                <p className="text-sm">No critical alerts right now.</p>
              </div>
            )}
            {bins.filter(bin => bin.fillLevel > 80).slice(0, 3).map(bin => (
              <div key={`bin-alert-${bin.id}`} className="p-4 rounded-xl border border-orange-100 bg-orange-50/50">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded uppercase">Bin Alert</span>
                  <span className="text-xs text-slate-500">{bin.lastUpdated || 'just now'}</span>
                </div>
                <h4 className="font-semibold text-slate-800 text-sm mt-2">{bin.id} approaching capacity ({Math.round(bin.fillLevel)}%)</h4>
                <p className="text-sm text-slate-600 flex items-center gap-1 mt-1"><MapPin className="w-3 h-3"/> {bin.location}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AIWasteDetection() {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const busyRef = useRef(false);

  const analyzeBlob = async (blob, filename = 'waste.jpg') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setAnalyzing(true);
    setError('');

    try {
      const data = await detectWasteImage(blob, filename);
      setResult({
        obj: data.detected_object,
        cat: data.category,
        conf: Math.round(Number(data.confidence) * 100),
        bin: data.recommended_bin,
        impact: data.impact,
        engine: data.engine,
        color: data.category?.toLowerCase().includes('organic') || data.category?.toLowerCase().includes('wet')
          ? 'text-emerald-400'
          : 'text-blue-400',
        bg: data.category?.toLowerCase().includes('organic') || data.category?.toLowerCase().includes('wet')
          ? 'bg-emerald-50'
          : 'bg-blue-50'
      });
    } catch (err) {
      setError(err.message || 'Waste detection failed. Start the FastAPI server and try again.');
    } finally {
      busyRef.current = false;
      setAnalyzing(false);
    }
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await analyzeBlob(file, file.name);
    event.target.value = '';
  };

  const captureAndAnalyze = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    if (blob) await analyzeBlob(blob, 'webcam-frame.jpg');
  };

  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });

      streamRef.current = stream;
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      setError('Camera permission was blocked or no camera was found.');
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  useEffect(() => {
    if (!cameraActive) return;

    const timer = setInterval(() => {
      captureAndAnalyze();
    }, 1800);

    return () => clearInterval(timer);
  }, [cameraActive]);

  useEffect(() => () => stopCamera(), []);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">AI Waste Classification</h1>
        <p className="text-slate-500">Upload an image or use the live webcam for real AI inference through FastAPI.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex gap-2 mb-5">
            <label className="flex-1 cursor-pointer bg-emerald-600 text-white px-4 py-3 rounded-xl font-medium text-center hover:bg-emerald-700">
              Upload Image
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} className="hidden" />
            </label>

            {!cameraActive ? (
              <button
                onClick={startCamera}
                className="flex-1 px-4 py-3 rounded-xl border border-slate-300 font-medium text-slate-700 hover:bg-slate-50"
              >
                <Camera className="w-4 h-4 inline mr-2" /> Use Live Webcam
              </button>
            ) : (
              <button
                onClick={stopCamera}
                className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700"
              >
                Stop Webcam
              </button>
            )}
          </div>

          <div className="rounded-2xl overflow-hidden bg-slate-900 aspect-video relative">
            {cameraActive ? (
              <>
                <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
                <div className="absolute top-3 left-3 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
                  LIVE • analyzing every ~1.8s
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500">
                <Camera className="w-12 h-12 opacity-40" />
              </div>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />

          <div className="mt-6 border-t border-slate-100 pt-5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Quick Demo</p>
            <div className="flex flex-wrap gap-2">
              {[
                ['plastic', 'Plastic Bottle'],
                ['food', 'Food Waste'],
                ['paper', 'Cardboard'],
                ['metal', 'Metal Can']
              ].map(([type, label]) => (
                <button
                  key={type}
                  onClick={() => {
                    // Demo buttons intentionally still work when backend is offline.
                    setAnalyzing(true);
                    setError('');
                    setTimeout(() => {
                      const demo = {
                        plastic: { obj: 'Plastic Bottle', cat: 'Recyclable', conf: 96, bin: 'Dry / Blue Bin', impact: 'Can be recycled and diverted from general landfill.', engine: 'Demo preset', color: 'text-blue-400', bg: 'bg-blue-50' },
                        food: { obj: 'Food Scraps', cat: 'Organic / Wet', conf: 92, bin: 'Wet / Green Bin', impact: 'Suitable for composting or controlled organic-waste processing.', engine: 'Demo preset', color: 'text-emerald-400', bg: 'bg-emerald-50' },
                        paper: { obj: 'Cardboard Box', cat: 'Recyclable', conf: 89, bin: 'Dry / Blue Bin', impact: 'Can be recycled into new paper and cardboard products.', engine: 'Demo preset', color: 'text-blue-400', bg: 'bg-blue-50' },
                        metal: { obj: 'Soda Can', cat: 'Metal / Recyclable', conf: 98, bin: 'Dry / Blue Bin', impact: 'Metal can be recovered and recycled repeatedly.', engine: 'Demo preset', color: 'text-blue-400', bg: 'bg-blue-50' }
                      };
                      setAnalyzing(false);
                      setResult(demo[type]);
                    }, 700);
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-slate-900 rounded-2xl p-1 shadow-lg relative overflow-hidden">
          <div className="relative h-full bg-slate-900 rounded-xl p-6 flex flex-col border border-slate-800">
            <div className="flex items-center gap-2 text-emerald-400 mb-6">
              <BrainCircuit className="w-5 h-5" />
              <h3 className="font-mono font-semibold tracking-wide">AI_ANALYSIS_ENGINE</h3>
            </div>

            {analyzing ? (
              <div className="flex-1 flex flex-col items-center justify-center text-emerald-500 space-y-4">
                <div className="w-12 h-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin"></div>
                <p className="font-mono text-sm animate-pulse">Processing image data...</p>
              </div>
            ) : result ? (
              <div className="flex-1 flex flex-col justify-center space-y-5">
                <div>
                  <p className="text-slate-400 text-xs font-mono mb-1">DETECTED_OBJECT</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-2xl font-bold text-white">{result.obj}</p>
                    {result.engine && <span className="px-2 py-1 rounded-full bg-white/10 border border-white/10 text-[10px] font-semibold text-slate-300 uppercase tracking-wide">{result.engine}</span>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                    <p className="text-slate-400 text-xs font-mono mb-1">CLASSIFICATION</p>
                    <p className={`font-semibold ${result.color}`}>{result.cat}</p>
                  </div>
                  <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                    <p className="text-slate-400 text-xs font-mono mb-1">CONFIDENCE</p>
                    <p className="font-semibold text-white">{result.conf}%</p>
                  </div>
                </div>

                <div className="bg-slate-800/70 p-4 rounded-xl border border-slate-700">
                  <p className="text-slate-400 text-xs font-mono mb-1">RECOMMENDED_ACTION</p>
                  <p className="text-lg font-bold text-white flex items-center gap-2">
                    <Trash2 className={`w-5 h-5 ${result.color}`} />
                    Place in {result.bin}
                  </p>
                </div>

                <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl">
                  <p className="text-emerald-300 text-xs font-mono mb-1">ENVIRONMENTAL_IMPACT</p>
                  <p className="text-slate-200 text-sm">{result.impact}</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 font-mono text-sm text-center px-8">
                Awaiting input... Upload an image or enable the webcam.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SmartBins() {
  const { bins, connectionStatus, setBins } = React.useContext(AppContext);
  const [refreshing, setRefreshing] = useState(false);

  const refreshData = async () => {
    setRefreshing(true);
    try {
      const latest = await apiFetch('/api/bins');
      setBins(latest);
    } catch (error) {
      console.warn(error);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Smart Bin Fleet</h1>
          <p className="text-slate-500">Live monitoring of connected waste receptacles.</p>
          <div className="flex items-center gap-2 mt-1"><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Streaming telemetry</span><span className="text-xs text-slate-400">Simulator ready</span></div>
          <p className="text-xs text-slate-400 mt-1">
            WebSocket: {connectionStatus === 'connected' ? 'connected' : 'using demo/local state'}
          </p>
        </div>
        <button
          onClick={refreshData}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 shadow-sm disabled:opacity-60"
        >
          {refreshing ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-xs">
              <tr>
                <th className="px-6 py-4">Bin ID</th>
                <th className="px-6 py-4">Location</th>
                <th className="px-6 py-4">Waste Type</th>
                <th className="px-6 py-4">Fill Level</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Last Sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bins.map((bin) => (
                <tr key={bin.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-900">{bin.id}</td>
                  <td className="px-6 py-4 text-slate-600">{bin.location}</td>
                  <td className="px-6 py-4">
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">{bin.type}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <span className="w-8 text-right font-medium text-slate-700">{Math.round(bin.fillLevel)}%</span>
                      <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${bin.fillLevel > 80 ? 'bg-red-500' : bin.fillLevel > 50 ? 'bg-yellow-400' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.max(0, Math.min(100, bin.fillLevel))}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                      ${bin.status === 'Critical' ? 'bg-red-100 text-red-700' :
                        bin.status === 'Attention' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-emerald-100 text-emerald-700'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${bin.status === 'Critical' ? 'bg-red-500' : bin.status === 'Attention' ? 'bg-yellow-500' : 'bg-emerald-500'}`} />
                      {bin.status || getBinStatus(bin.fillLevel)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-400 text-xs">{bin.lastUpdated || 'just now'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SanitationMonitoring() {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);

  const handleSimulate = () => {
    setAnalyzing(true);
    setResult(null);
    setTimeout(() => {
      setAnalyzing(false);
      setResult({
        area: 'Market Road South',
        detection: 'Garbage accumulation & Overflowing bin',
        severity: 'High',
        score: 35,
        action: 'Immediate dispatch required'
      });
    }, 2000);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sanitation Area Monitor</h1>
          <p className="text-slate-500">Analyze a demonstration CCTV/drone frame for public-area cleanliness. Plug in a vision model here when available.</p>
        </div>
        <button 
          onClick={handleSimulate}
          disabled={analyzing}
          className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-medium hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-70 flex items-center gap-2"
        >
          <Camera className="w-4 h-4"/> Run Analysis Scan
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Mock Image Display */}
        <div className="lg:col-span-2 bg-slate-900 rounded-2xl overflow-hidden relative min-h-[400px] flex items-center justify-center shadow-md">
          {analyzing && (
            <div className="absolute inset-0 bg-slate-900/80 z-10 flex flex-col items-center justify-center text-emerald-400">
               <div className="w-16 h-16 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
               <p className="font-mono tracking-widest">ANALYZING SPATIAL DATA...</p>
               {/* Scanning line effect */}
               <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.5)] animate-[scan_2s_ease-in-out_infinite]"></div>
            </div>
          )}
          {result ? (
            <div className="relative w-full h-full bg-slate-800 p-8">
              {/* Fake image background pattern */}
               <div className="absolute inset-0 opacity-20 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHBhdGggZD0iTTAgMGg0MHY0MEgwVjB6bTIwIDIwYzAgMTEuMDQ2IDguOTU0IDIwIDIwIDIwcy0yMC04Ljk1NC0yMC0yMEMwIDguOTU0IDguOTU0IDAgMjAgMHMyMCA4Ljk1NCAyMCAyMHoiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSIgZmlsbC1ydWxlPSJldmVub2RkIi8+PC9zdmc+')]"></div>
               
               {/* Bounding box mock */}
               <div className="absolute top-1/4 left-1/4 w-1/3 h-1/3 border-2 border-red-500 bg-red-500/10 rounded-lg">
                 <span className="absolute -top-6 left-0 bg-red-500 text-white text-xs font-mono px-2 py-1 rounded">DETECTED: DEBRIS [92%]</span>
               </div>
               
               <div className="absolute bottom-4 left-4 text-slate-400 font-mono text-sm">
                 CAM_FEED: 04_MARKET_ST | T-STAMP: {new Date().toLocaleTimeString()}
               </div>
            </div>
          ) : (
             <div className="text-slate-500 flex flex-col items-center gap-3">
               <Camera className="w-12 h-12 opacity-50" />
               <p>Ready for scan input</p>
             </div>
          )}
        </div>

        {/* Results Panel */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col">
          <h3 className="font-bold text-slate-800 mb-6 border-b border-slate-100 pb-4">Analysis Report</h3>
          
          {result ? (
            <div className="space-y-6 flex-1">
              {/* Gauge mock */}
              <div className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-sm font-semibold text-slate-500 mb-1">Cleanliness Score</span>
                <div className="text-4xl font-extrabold text-red-500">{result.score}<span className="text-xl text-slate-400">/100</span></div>
                <div className="w-full h-1.5 bg-slate-200 rounded-full mt-3 overflow-hidden">
                  <div className="h-full bg-red-500" style={{ width: `${result.score}%` }}></div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-xs text-slate-400 uppercase font-semibold">Location</p>
                  <p className="font-medium text-slate-800">{result.area}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase font-semibold">Primary Issue</p>
                  <p className="font-medium text-slate-800">{result.detection}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase font-semibold">Severity Assessment</p>
                  <span className="inline-block mt-1 px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold uppercase tracking-wider">
                    {result.severity}
                  </span>
                </div>
              </div>

              <div className="mt-auto pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-400 uppercase font-semibold mb-2">System Recommendation</p>
                <div className="bg-emerald-50 text-emerald-800 p-3 rounded-lg text-sm font-medium flex gap-2 items-start">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {result.action}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm text-center">
              Run a scan to generate a report.
            </div>
          )}
        </div>
      </div>
      {/* Add keyframes for animation in a style tag for this specific trick */}
      <style>{`
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function CitizenReport() {
  const { reportIssue } = React.useContext(AppContext);
  const [formData, setFormData] = useState({
    location: '',
    type: 'Overflowing Bin',
    description: '',
    locationType: 'Market',
    fillLevel: 80,
    reportCount: 1
  });
  const [submitted, setSubmitted] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [priorityPreview, setPriorityPreview] = useState(null);

  const severityByType = {
    'Overflowing Bin': 'High',
    'Garbage Dump': 'Critical',
    'Roadside Waste': 'Medium',
    'Mixed Waste': 'High',
    'Unclean Public Area': 'Medium'
  };

  const calculatePreview = async () => {
    if (!formData.location) return;
    try {
      const data = await apiFetch('/api/priority/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fill_level: Number(formData.fillLevel),
          severity: severityByType[formData.type],
          location_type: formData.locationType,
          time_elapsed_mins: 5,
          report_count: Number(formData.reportCount)
        })
      });
      setPriorityPreview(data);
    } catch (error) {
      setPriorityPreview(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.location) return;

    setSubmitting(true);

    try {
      const priority = await apiFetch('/api/priority/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fill_level: Number(formData.fillLevel),
          severity: severityByType[formData.type],
          location_type: formData.locationType,
          time_elapsed_mins: 5,
          report_count: Number(formData.reportCount)
        })
      });

      const saved = await reportIssue({
        location: formData.location,
        type: formData.type,
        description: formData.description,
        severity: priority.severity,
        score: priority.score,
        locationType: formData.locationType,
        fillLevel: Number(formData.fillLevel),
        reportCount: Number(formData.reportCount)
      });

      setSubmitted(saved);
      setPriorityPreview(priority);
      setFormData({
        location: '',
        type: 'Overflowing Bin',
        description: '',
        locationType: 'Market',
        fillLevel: 80,
        reportCount: 1
      });
    } catch (error) {
      alert(error.message || 'Could not submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          </div>
          <h3 className="text-2xl font-bold text-slate-800">Report Submitted!</h3>
          <p className="text-slate-500 mt-2">
            Report <span className="font-mono font-semibold">{submitted.id}</span> is now visible to the authority command center.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 text-left">
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-xs text-slate-400 uppercase font-semibold">Priority Score</p>
              <p className="text-2xl font-bold text-slate-900">{submitted.score}/100</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-xs text-slate-400 uppercase font-semibold">Priority</p>
              <p className="text-2xl font-bold text-red-600">{submitted.severity}</p>
            </div>
          </div>

          <button
            onClick={() => setSubmitted(null)}
            className="mt-6 w-full bg-emerald-600 text-white font-bold py-3 rounded-xl hover:bg-emerald-700"
          >
            Submit Another Report
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-emerald-600 p-6 md:p-8 text-white">
          <h2 className="text-2xl font-bold mb-2">Report Sanitation Issue</h2>
          <p className="text-emerald-100 text-sm">Report an issue and let the GreenSync priority engine route it into the live authority queue.</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-6">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Location *</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                required
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
                placeholder="E.g., Central Market, Gate 2"
                value={formData.location}
                onChange={e => setFormData({ ...formData, location: e.target.value })}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Issue Type</label>
              <select
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white"
                value={formData.type}
                onChange={e => setFormData({ ...formData, type: e.target.value })}
              >
                <option>Overflowing Bin</option>
                <option>Garbage Dump</option>
                <option>Roadside Waste</option>
                <option>Mixed Waste</option>
                <option>Unclean Public Area</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Location Type</label>
              <select
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white"
                value={formData.locationType}
                onChange={e => setFormData({ ...formData, locationType: e.target.value })}
              >
                <option>Market</option>
                <option>School</option>
                <option>Hospital</option>
                <option>Residential</option>
                <option>Road</option>
                <option>Park</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Observed Bin Fill Level: {formData.fillLevel}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={formData.fillLevel}
              onChange={e => setFormData({ ...formData, fillLevel: e.target.value })}
              className="w-full accent-emerald-600"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Recent Report Count</label>
            <input
              type="number"
              min="1"
              max="10"
              value={formData.reportCount}
              onChange={e => setFormData({ ...formData, reportCount: e.target.value })}
              className="w-full px-4 py-3 rounded-xl border border-slate-300"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Description</label>
            <textarea
              rows="3"
              className="w-full px-4 py-3 rounded-xl border border-slate-300 resize-none"
              placeholder="Additional details..."
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <button
            type="button"
            onClick={calculatePreview}
            className="w-full border border-emerald-200 text-emerald-700 font-semibold py-3 rounded-xl hover:bg-emerald-50"
          >
            Calculate Priority Preview
          </button>

          {priorityPreview && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex justify-between items-center">
              <div>
                <p className="text-xs text-slate-400 uppercase font-semibold">Live Priority Engine</p>
                <p className="font-semibold text-slate-800">{priorityPreview.priority_status}</p>
              </div>
              <div className="text-2xl font-bold text-slate-900">{priorityPreview.score}/100</div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? 'Submitting...' : 'Submit Report to Authority'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ActionCenter() {
  const { issues, updateIssueStatus } = React.useContext(AppContext);
  
  // Sort by score descending
  const sortedIssues = [...issues].sort((a, b) => (b.score || 0) - (a.score || 0));
  
  const handleAssign = (id) => {
    updateIssueStatus(id, 'Assigned', 'Quick Response Team');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Action Center</h1>
        <p className="text-slate-500">AI-prioritized queue of sanitation tasks requiring delegation.</p>
      </div>

      <div className="grid gap-4">
        {sortedIssues.filter(i => i.status !== 'Resolved').map((issue, idx) => (
          <div key={issue.id} className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:shadow-md">
            
            <div className="flex gap-4 md:gap-6 items-start md:items-center w-full md:w-auto">
              {/* Priority Score Circle */}
              <div className="relative shrink-0 flex items-center justify-center w-14 h-14 rounded-full bg-slate-50 border-2 border-slate-100">
                <svg className="w-full h-full absolute -rotate-90" viewBox="0 0 36 36">
                  <path
                    className="text-slate-100" stroke="currentColor" strokeWidth="3" fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    className={issue.score > 90 ? "text-red-500" : issue.score > 70 ? "text-yellow-500" : "text-emerald-500"}
                    strokeDasharray={`${issue.score || 0}, 100`}
                    stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <div className="text-center absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-sm font-bold text-slate-800 leading-none">{issue.score}</span>
                </div>
              </div>

              <div className="space-y-1 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-lg">{issue.type}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide
                    ${issue.severity === 'Critical' ? 'bg-red-100 text-red-700' : 
                      issue.severity === 'High' ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-800'}`}>
                    {issue.severity}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
                  <span className="flex items-center gap-1"><MapPin className="w-4 h-4"/> {issue.location}</span>
                  <span className="flex items-center gap-1"><Clock className="w-4 h-4"/> {new Date(issue.reportedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                  <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">ID: {issue.id}</span>
                </div>
              </div>
            </div>

            <div className="w-full md:w-auto flex flex-col md:items-end gap-2 shrink-0 border-t md:border-t-0 border-slate-100 pt-4 md:pt-0">
              {issue.status === 'Pending' ? (
                <>
                  <p className="text-xs text-slate-500 mb-1 font-medium">Recommended: Dispatch Team</p>
                  <button 
                    onClick={() => handleAssign(issue.id)}
                    className="w-full md:w-auto px-5 py-2.5 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 shadow-sm transition-colors"
                  >
                    Assign Worker
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-500 font-medium">Status</p>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold
                    ${issue.status === 'In Progress' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
                    {issue.status === 'In Progress' ? <Activity className="w-4 h-4"/> : <Users className="w-4 h-4"/>}
                    {issue.status} - {issue.assignedTo}
                  </span>
                </>
              )}
            </div>
            
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkerDashboard() {
  const { issues, updateIssueStatus } = React.useContext(AppContext);
  
  // In a real app, filter by current logged-in worker ID.
  const myTasks = issues.filter(i => (i.status === 'Assigned' || i.status === 'In Progress') && i.status !== 'Resolved');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Assigned Tasks</h1>
        <p className="text-slate-500">Update task status to keep the command center informed.</p>
      </div>

      {myTasks.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckSquare className="w-8 h-8 text-emerald-500" />
          </div>
          <h3 className="text-xl font-bold text-slate-800">All caught up!</h3>
          <p className="text-slate-500 mt-2">No pending tasks assigned to you right now.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {myTasks.map(task => (
            <div key={task.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <span className="font-mono text-sm font-bold text-slate-600">{task.id}</span>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider
                  ${task.severity === 'Critical' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                  {task.severity} Priority
                </span>
              </div>
              <div className="p-5 md:p-6">
                <h3 className="text-xl font-bold text-slate-900 mb-2">{task.type}</h3>
                <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 mb-6">
                  <div className="flex items-start gap-2 text-slate-600">
                    <MapPin className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-sm text-slate-900">Location</p>
                      <p className="text-sm">{task.location}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-slate-600">
                    <Clock className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-sm text-slate-900">Reported At</p>
                      <p className="text-sm">{new Date(task.reportedAt).toLocaleTimeString()}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 border-t border-slate-100 pt-5">
                  {task.status === 'Assigned' ? (
                    <button 
                      onClick={() => updateIssueStatus(task.id, 'In Progress')}
                      className="flex-1 bg-blue-600 text-white font-medium py-2.5 rounded-xl hover:bg-blue-700 transition-colors flex justify-center items-center gap-2"
                    >
                      <Activity className="w-5 h-5" /> Start Task
                    </button>
                  ) : (
                    <button 
                      onClick={() => updateIssueStatus(task.id, 'Resolved')}
                      className="flex-1 bg-emerald-600 text-white font-medium py-2.5 rounded-xl hover:bg-emerald-700 transition-colors flex justify-center items-center gap-2 shadow-sm"
                    >
                      <CheckCircle className="w-5 h-5" /> Mark Resolved
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalyticsDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2"><h1 className="text-2xl font-bold text-slate-900">Sanitation Analytics</h1><span className="px-2 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold uppercase tracking-wide">Demo baseline</span></div>
        <p className="text-slate-500">Baseline visualizations for the hackathon demo; replace with stored collection data in production.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Waste Collection Trend */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="font-bold text-slate-800 mb-6">Weekly Waste Collection Trend (kg)</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer>
              <AreaChart data={CHART_DATA.wasteTrends} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorOrganic" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorPlastic" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dx={-10} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }}/>
                <Area type="monotone" dataKey="organic" name="Organic" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorOrganic)" />
                <Area type="monotone" dataKey="plastic" name="Plastic" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorPlastic)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Waste Composition */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <h3 className="font-bold text-slate-800 mb-2">Overall Waste Composition</h3>
          <p className="text-sm text-slate-500 mb-6">Based on AI classification data from smart bins.</p>
          <div className="h-[250px] w-full flex-1">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={CHART_DATA.composition}
                  cx="50%" cy="50%"
                  innerRadius={70} outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {CHART_DATA.composition.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value) => `${value}%`}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Custom Legend to fit nicely */}
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-4">
            {CHART_DATA.composition.map((item, idx) => (
              <div key={idx} className="flex items-center gap-1.5 text-sm">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></span>
                <span className="text-slate-600">{item.name}</span>
                <span className="font-semibold text-slate-900">{item.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AIInsights() {
  const insights = [
    {
      title: "Optimize Collection Route",
      desc: "Central Market experiences a 40% spike in waste accumulation between 5 PM and 8 PM daily.",
      rec: "Schedule an additional focused collection route during this window to prevent overflow.",
      type: "Logistics",
      icon: Truck
    },
    {
      title: "Capacity Upgrade Needed",
      desc: "Bin B-101 and B-201 frequently reach critical capacity within 4 hours of emptying.",
      rec: "Deploy larger capacity bins or smart compactors in these high-footfall locations.",
      type: "Infrastructure",
      icon: TrendingUp
    },
    {
      title: "Segregation Improvement",
      desc: "High volume of recyclable plastic is ending up in mixed waste at the Food Street zone.",
      rec: "Increase visibility and number of dedicated dry/recyclable bins in this specific area.",
      type: "Behavioral",
      icon: Users
    }
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <div className="flex items-center gap-2"><h1 className="text-2xl font-bold text-slate-900">GreenSync Intelligence</h1><span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wide">Prototype insights</span></div>
        <p className="text-slate-500">Illustrative recommendations based on the demo data and operating patterns.</p>
      </div>

      <div className="space-y-4">
        {insights.map((insight, idx) => (
          <div key={idx} className="bg-white p-6 rounded-2xl border border-emerald-100 shadow-sm shadow-emerald-50 relative overflow-hidden group hover:border-emerald-300 transition-colors">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-emerald-500"></div>
            
            <div className="flex items-start gap-4">
              <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600 shrink-0">
                <BrainCircuit className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-bold text-slate-900">{insight.title}</h3>
                  <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-1 rounded uppercase tracking-wider">{insight.type}</span>
                </div>
                <p className="text-slate-600 mb-4">{insight.desc}</p>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">AI Recommendation</p>
                  <p className="font-medium text-slate-800">{insight.rec}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Icons needed for Insights that aren't imported top level to avoid clutter if not used elsewhere
function Truck(props) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>;
}
function TrendingUp(props) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>;
}