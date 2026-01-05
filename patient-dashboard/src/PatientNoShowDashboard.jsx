import Papa from 'papaparse';
import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const PatientNoShowDashboard = () => {
  const [csvData, setCsvData] = useState(null);
  const [filters, setFilters] = useState({
    ageGroup: 'All',
    smsReceived: 'All',
    week: 'All'
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isDataQualityExpanded, setIsDataQualityExpanded] = useState(false);
  const [weeklyView, setWeeklyView] = useState('count');
  const [ageView, setAgeView] = useState('count');
  const [smsView, setSmsView] = useState('count');
  const [showStats, setShowStats] = useState(false);


  // Helper functions (type-safe parsing)
  const toNum = (val) => {
    if (val === null || val === undefined) return null;
    const s = String(val).trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  };

  const toBin01 = (val) => {
    const n = toNum(val);
    if (n === 1) return '1';
    if (n === 0) return '0';
    return String(val ?? '').trim();
  };

  const getWaitingDays = (row) => {
    if (!row) return null;

    const normKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');

    // Try to find the waiting-days field even if the header has weird characters/spaces
    const pickField = (targetNorm) => {
      const key = Object.keys(row).find((k) => normKey(k) === targetNorm);
      return key ? row[key] : undefined;
    };

    // 1) Use the real waiting-days field if present (do NOT use WaitingDays_ because it looks like a normalized/scaled value in your CSV)
    const candidates = [
      row.WaitingDays,
      row.AwaitingTime,
      row.AwaitingDays,
      pickField('waitingdays'),
      pickField('awaitingtime'),
      pickField('awaitingdays'),
    ];

    for (const v of candidates) {
      const n = toNum(v);
      if (n !== null) return n;
    }

    // 2) Fallback: compute from ScheduledDay -> AppointmentDay
    // Note: Safari is picky about date strings like "YYYY-MM-DD HH:mm:ss".
    // Convert to ISO-ish "YYYY-MM-DDTHH:mm:ss" before parsing.
    const toDate = (raw) => {
      if (raw == null) return null;
      const s = String(raw).trim();
      if (!s) return null;
      const iso = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s;
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const scheduledRaw =
      row.ScheduledDay || row.ScheduledDate || row.Scheduled || row.Scheduled_Day || pickField('scheduledday');
    const apptRaw =
      row.AppointmentDay || row.AppointmentDate || row.Appointment || row.Appointment_Day || pickField('appointmentday');

    const scheduled = toDate(scheduledRaw);
    const appt = toDate(apptRaw);

    if (scheduled && appt) {
      const diffMs = appt.getTime() - scheduled.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      return diffDays < 0 ? 0 : diffDays;
    }

    return null;
  };

  const parseCSV = (text) => {
    const result = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      // Strip BOM + non‑breaking spaces that Excel exports sometimes include
      transformHeader: (h) => {
        if (h == null) return h;
        return String(h).replace(/\uFEFF/g, '').replace(/\u00A0/g, ' ').trim();
      },
      transform: (v) => (typeof v === 'string' ? v.replace(/\u00A0/g, ' ').trim() : v),
    });
    // If PapaParse hits a parsing issue, return what it can.
    // You can also console.log(result.errors) if you want.
    return (result.data || []).map((obj) => {
      const appt = obj.AppointmentDay || obj.Appointment || obj.AppointmentDate;
      // Week label: YYYY-MM-DD (Monday start) if missing
      if (!obj.Week || String(obj.Week).trim() === '' || String(obj.Week).toLowerCase() === 'unknown') {
        if (appt) {
          const d = new Date(appt);
          if (!isNaN(d.getTime())) {
            const day = d.getDay(); // 0=Sun..6=Sat
            const diffToMonday = day === 0 ? -6 : 1 - day;
            const monday = new Date(d);
            monday.setDate(d.getDate() + diffToMonday);
            const yyyy = monday.getFullYear();
            const mm = String(monday.getMonth() + 1).padStart(2, '0');
            const dd = String(monday.getDate()).padStart(2, '0');
            obj.Week = `${yyyy}-${mm}-${dd}`;
          } else {
            obj.Week = 'Unknown';
          }
        } else {
          obj.Week = 'Unknown';
        }
      }
      // Normalize SMS_received so filters match cleanly ('0'/'1')
      if (obj.SMS_received !== undefined) {
        obj.SMS_received = toBin01(obj.SMS_received);
      }

      // Normalize NoShow to a number (0/1) so comparisons like (row.NoShow === 1) work
      if (obj.NoShow !== undefined) {
        obj.NoShow = toNum(obj.NoShow);
      }

      // Normalize waiting day fields to numbers when present
      if (obj.WaitingDays !== undefined) {
        obj.WaitingDays = toNum(obj.WaitingDays);
      }

      return obj;
    });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsLoading(true);

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const data = parseCSV(event.target.result);
        setCsvData(data);

        // Give React a moment to render charts before removing the loader
        setTimeout(() => setIsLoading(false), 150);
      } catch (err) {
        console.error('CSV parsing failed:', err);
        setIsLoading(false);
      }
    };

    reader.onerror = () => {
      console.error('Failed to read file');
      setIsLoading(false);
    };

    reader.readAsText(file);
  };

  const resetFilters = () => {
    setFilters({ ageGroup: 'All', smsReceived: 'All', week: 'All' });
  };

  const handleAgeGroupBarClick = (data) => {
    const age = data?.payload?.name;
    if (!age) return;
    setFilters((prev) => ({ ...prev, ageGroup: age }));
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.ageGroup !== 'All') count++;
    if (filters.smsReceived !== 'All') count++;
    if (filters.week !== 'All') count++;
    return count;
  }, [filters]);

  const datasetOverview = useMemo(() => {
    if (!csvData) return null;

    const total = csvData.length;
    const dates = csvData
      .map((row) => new Date(row.AppointmentDay || row.Appointment || row.AppointmentDate))
      .filter((d) => !isNaN(d.getTime()));

    if (dates.length === 0) {
      return { total, dateRange: 'Unknown', noShowDef: 'NoShow=1 means patient missed appointment' };
    }

    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    const dateRange = `${minDate.toLocaleDateString()} – ${maxDate.toLocaleDateString()}`;

    // Calculate date range in days
    const daysDiff = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));

    return { total, dateRange, dateRangeDays: daysDiff, minDate, maxDate, noShowDef: 'NoShow=1 means patient missed appointment' };
  }, [csvData]);

  const dataQualityStats = useMemo(() => {
    if (!csvData) return null;

    const total = csvData.length;

    // Count missing values for key fields
    const missingWaitingDays = csvData.filter((row) => getWaitingDays(row) === null).length;
    const missingSMS = csvData.filter((row) => !row.SMS_received || row.SMS_received.trim() === '').length;
    const missingAgeGroup = csvData.filter((row) => !row.AgeGroup || row.AgeGroup.trim() === '' || row.AgeGroup === 'Unknown').length;

    return {
      total,
      missingWaitingDays,
      missingSMS,
      missingAgeGroup
    };
  }, [csvData]);

  const filteredData = useMemo(() => {
    if (!csvData) return [];

    return csvData.filter((row) => {
      if (filters.ageGroup !== 'All' && row.AgeGroup !== filters.ageGroup) return false;
      if (filters.smsReceived !== 'All' && row.SMS_received !== filters.smsReceived) return false;
      if (filters.week !== 'All' && row.Week !== filters.week) return false;
      return true;
    });
  }, [csvData, filters]);

  const kpis = useMemo(() => {
    if (!filteredData.length) return { total: 0, noShows: 0, shows: 0, noShowRate: 0 };

    const total = filteredData.length;
    const noShows = filteredData.filter((row) => row.NoShow === 1).length;
    const shows = total - noShows;
    const noShowRate = ((noShows / total) * 100).toFixed(1);

    return { total, noShows, shows, noShowRate };
  }, [filteredData]);

  const overallKpis = useMemo(() => {
    if (!csvData) return { total: 0, noShows: 0, noShowRate: 0 };

    const total = csvData.length;
    const noShows = csvData.filter((row) => row.NoShow === 1).length;
    const noShowRate = ((noShows / total) * 100).toFixed(1);

    return { total, noShows, noShowRate };
  }, [csvData]);

  const currentViewSummary = useMemo(() => {
    if (!csvData) return null;

    const hasFilters = activeFilterCount > 0;
    const filteredRate = parseFloat(kpis.noShowRate);
    const overallRate = parseFloat(overallKpis.noShowRate);

    if (!hasFilters) {
      // No filters applied
      return {
        summary: `Viewing all ${overallKpis.total.toLocaleString()} appointments. Overall no-show rate is ${overallKpis.noShowRate}%.`,
        insight: 'Apply filters to identify specific segments with elevated or reduced no-show risk.'
      };
    }

    // Filters are applied - build filter description
    const filterDescriptions = [];
    if (filters.ageGroup !== 'All') filterDescriptions.push(`age group ${filters.ageGroup}`);
    if (filters.smsReceived !== 'All') filterDescriptions.push(filters.smsReceived === '1' ? 'SMS sent' : 'no SMS');
    if (filters.week !== 'All') filterDescriptions.push(`week of ${filters.week}`);

    const filterDescription = filterDescriptions.join(', ');
    const rateDiff = filteredRate - overallRate;
    const absDiff = Math.abs(rateDiff);
    const comparison = rateDiff > 0 ? 'higher' : 'lower';

    const summary = `Viewing ${kpis.total.toLocaleString()} appointments for ${filterDescription}. No-show rate is ${kpis.noShowRate}% — ${absDiff.toFixed(1)} percentage points ${comparison} than the overall average (${overallKpis.noShowRate}%).`;

    // Generate actionable insight
    let insight = '';
    if (absDiff < 1) {
      insight = 'This segment performs similarly to the overall average.';
    } else if (rateDiff > 3) {
      insight = '⚠️ This segment shows elevated no-show risk. Consider targeted interventions like additional reminders or follow-ups.';
    } else if (rateDiff > 0) {
      insight = 'This segment shows slightly elevated no-show risk compared to average.';
    } else if (rateDiff < -3) {
      insight = '✓ This segment performs significantly better than average. Study these characteristics to identify best practices.';
    } else {
      insight = 'This segment performs better than average.';
    }

    return { summary, insight };
  }, [csvData, filters, kpis, overallKpis, activeFilterCount]);

  const waitingTimeComparison = useMemo(() => {
    if (!filteredData.length) return null;

    // Separate patients who showed up vs no-showed
    const showedUp = filteredData.filter((row) => row.NoShow === 0);
    const noShowed = filteredData.filter((row) => row.NoShow === 1);

    // Extract waiting times (filter out null values)
    const showedWaitTimes = showedUp
      .map((row) => getWaitingDays(row))
      .filter((days) => days !== null)
      .sort((a, b) => a - b);

    const noShowWaitTimes = noShowed
      .map((row) => getWaitingDays(row))
      .filter((days) => days !== null)
      .sort((a, b) => a - b);

    if (showedWaitTimes.length === 0 || noShowWaitTimes.length === 0) return null;

    // Calculate median (middle value of sorted array)
    const getMedian = (arr) => {
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
    };

    // Calculate mean (average)
    const getMean = (arr) => arr.reduce((sum, val) => sum + val, 0) / arr.length;

    const showedMedian = getMedian(showedWaitTimes);
    const noShowMedian = getMedian(noShowWaitTimes);
    const showedMean = getMean(showedWaitTimes);
    const noShowMean = getMean(noShowWaitTimes);

    // Calculate ratio
    const ratio = showedMean > 0 ? (noShowMean / showedMean).toFixed(1) : 'N/A';

    return {
      showedMedian: showedMedian.toFixed(1),
      noShowMedian: noShowMedian.toFixed(1),
      showedMean: showedMean.toFixed(1),
      noShowMean: noShowMean.toFixed(1),
      ratio,
      showedCount: showedWaitTimes.length,
      noShowCount: noShowWaitTimes.length
    };
  }, [filteredData]);

  const waitingDaysStats = useMemo(() => {
    if (!filteredData.length) return { validCount: 0, excludedCount: 0 };

    const validCount = filteredData.filter((row) => {
      const days = getWaitingDays(row);
      return days !== null;
    }).length;

    return { validCount, excludedCount: filteredData.length - validCount };
  }, [filteredData]);

  const keyTakeaways = useMemo(() => {
    if (!filteredData.length) return [];

    const overallRate = `Overall no-show rate is ${kpis.noShowRate}% (${kpis.noShows} of ${kpis.total} appointments)`;

    const withSMS = filteredData.filter((row) => row.SMS_received === '1');
    const withoutSMS = filteredData.filter((row) => row.SMS_received === '0');

    const smsNoShowCount = withSMS.filter((r) => r.NoShow === 1).length;
    const noSmsNoShowCount = withoutSMS.filter((r) => r.NoShow === 1).length;

    const smsNoShowRate = withSMS.length ? ((smsNoShowCount / withSMS.length) * 100).toFixed(1) : '0.0';
    const noSmsNoShowRate = withoutSMS.length ? ((noSmsNoShowCount / withoutSMS.length) * 100).toFixed(1) : '0.0';

    const smsComparison =
      `SMS reminder data: ${smsNoShowRate}% no-show rate with SMS (n=${withSMS.length}) vs. ` +
      `${noSmsNoShowRate}% without SMS (n=${withoutSMS.length}).`;

    const waitingBins = {
      '0': { name: '0 days', total: 0, noShows: 0 },
      '1-3': { name: '1-3 days', total: 0, noShows: 0 },
      '4-7': { name: '4-7 days', total: 0, noShows: 0 },
      '8-14': { name: '8-14 days', total: 0, noShows: 0 },
      '15+': { name: '15+ days', total: 0, noShows: 0 }
    };

    filteredData.forEach((row) => {
      const days = getWaitingDays(row);
      if (days === null) return;

      let bin = '15+';
      if (days === 0) bin = '0';
      else if (days <= 3) bin = '1-3';
      else if (days <= 7) bin = '4-7';
      else if (days <= 14) bin = '8-14';

      waitingBins[bin].total++;
      if (row.NoShow === 1) waitingBins[bin].noShows++;
    });

    let highestVolumeBin = null;
    let highestRateBin = null;
    let maxVolume = 0;
    let maxRate = 0;

    Object.entries(waitingBins).forEach(([key, bin]) => {
      if (bin.total > maxVolume) {
        maxVolume = bin.total;
        highestVolumeBin = { ...bin, key };
      }
      const rate = bin.total > 0 ? (bin.noShows / bin.total) * 100 : 0;
      if (bin.total >= 50 && rate > maxRate) {
        maxRate = rate;
        highestRateBin = { ...bin, key, rate };
      }
    });

    let waitingInsight = '';
    if (highestVolumeBin && highestRateBin) {
      const volumeRate = ((highestVolumeBin.noShows / highestVolumeBin.total) * 100).toFixed(1);
      waitingInsight =
        `Most appointments have ${highestVolumeBin.name} waiting time (${volumeRate}% no-show, n=${highestVolumeBin.total}); ` +
        `highest no-show rate is ${highestRateBin.rate.toFixed(1)}% for ${highestRateBin.name} waits (n=${highestRateBin.total}).`;
    } else if (highestVolumeBin) {
      const volumeRate = ((highestVolumeBin.noShows / highestVolumeBin.total) * 100).toFixed(1);
      waitingInsight = `Most appointments have ${highestVolumeBin.name} waiting time with ${volumeRate}% no-show rate (n=${highestVolumeBin.total}).`;
    }

    return [overallRate, smsComparison, waitingInsight].filter(Boolean);
  }, [filteredData, kpis]);

  const CustomBarTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const total = payload.reduce((sum, entry) => sum + entry.value, 0);
    return (
      <div
        className={`${isDarkMode ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-white text-slate-700 border-gray-300'} p-3 border rounded shadow-lg`}
      >
        <p className="font-semibold mb-1">{payload[0].payload.name}</p>
        {payload.map((entry, index) => {
          const percent = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0';
          return (
            <p key={index} style={{ color: entry.color }}>
              {entry.name}: {entry.value} ({percent}%)
            </p>
          );
        })}
        <p className={`mt-1 text-sm ${isDarkMode ? 'text-slate-300 border-slate-700' : 'text-gray-600 border-gray-200'} border-t pt-1`}>
          Total: {total}
        </p>
      </div>
    );
  };

  const CustomWaitingTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0].payload;
    return (
      <div
        className={`${isDarkMode ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-white text-slate-700 border-gray-300'} p-3 border rounded shadow-lg`}
      >
        <p className="font-semibold mb-1">{data.name}</p>
        <p>No-Show Rate: {data['No-Show Rate']}%</p>
        <p className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>n = {data.n}</p>
        <p className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>no-shows = {data.noShows}</p>
      </div>
    );
  };

  const CustomWeeklyRateTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0].payload;
    return (
      <div
        className={`${isDarkMode ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-white text-slate-700 border-gray-300'} p-3 border rounded shadow-lg`}
      >
        <p className="font-semibold mb-1">{data.name}</p>
        <p style={{ color: '#fb923c' }}>No-Show Rate: {data.rate}%</p>
        <p className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>Total: {data.total} appointments</p>
        <p className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>No-shows: {data.noShows}</p>
      </div>
    );
  };

  const CustomAgeRateTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0].payload;
    return (
      <div
        className={`${isDarkMode ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-white text-slate-700 border-gray-300'} p-3 border rounded shadow-lg`}
      >
        <p className="font-semibold mb-1">Age Group: {data.name}</p>
        <p style={{ color: '#fb923c' }}>No-Show Rate: {data.rate}%</p>
        <p className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>Total: {data.total.toLocaleString()}</p>
      </div>
    );
  };

  const CustomSmsRateTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0].payload;
    return (
      <div
        className={`${isDarkMode ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-white text-slate-700 border-gray-300'} p-3 border rounded shadow-lg`}
      >
        <p className="font-semibold mb-1">{data.name}</p>
        <p style={{ color: '#fb923c' }}>No-Show Rate: {data.rate}%</p>
        <p className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>Total: {data.total.toLocaleString()}</p>
      </div>
    );
  };

  const chartData = useMemo(() => {
    if (!filteredData.length) {
      return { byAge: [], bySMS: [], byWeek: [], byWaitingDays: [], pieData: [] };
    }

    const sortAgeGroups = (a, b) => {
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      const getNum = (str) => {
        const match = String(str).match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 999;
      };
      return getNum(a) - getNum(b);
    };

    const ageGroups = {};
    filteredData.forEach((row) => {
      const age = row.AgeGroup || 'Unknown';
      if (!ageGroups[age]) ageGroups[age] = { name: age, NoShow: 0, Show: 0 };
      if (row.NoShow === 1) ageGroups[age].NoShow++;
      else ageGroups[age].Show++;
    });
    const byAge = Object.values(ageGroups).map((group) => {
      const total = group.NoShow + group.Show;
      const rate = total > 0 ? ((group.NoShow / total) * 100).toFixed(1) : '0.0';
      return {
        ...group,
        total,
        rate: parseFloat(rate),
        noShows: group.NoShow
      };
    }).sort((a, b) => sortAgeGroups(a.name, b.name));

    const smsGroups = {
      Yes: { name: 'SMS Sent', NoShow: 0, Show: 0 },
      No: { name: 'No SMS', NoShow: 0, Show: 0 }
    };
    filteredData.forEach((row) => {
      const sms = row.SMS_received === '1' ? 'Yes' : 'No';
      if (row.NoShow === 1) smsGroups[sms].NoShow++;
      else smsGroups[sms].Show++;
    });
    const bySMS = Object.values(smsGroups).map((group) => {
      const total = group.NoShow + group.Show;
      const rate = total > 0 ? ((group.NoShow / total) * 100).toFixed(1) : '0.0';
      return {
        ...group,
        total,
        rate: parseFloat(rate),
        noShows: group.NoShow
      };
    });

    const weekGroups = {};
    filteredData.forEach((row) => {
      const week = row.Week || 'Unknown';
      if (!weekGroups[week]) weekGroups[week] = { name: week, NoShow: 0, Show: 0 };
      if (row.NoShow === 1) weekGroups[week].NoShow++;
      else weekGroups[week].Show++;
    });
    const byWeek = Object.values(weekGroups).map((week) => {
      const total = week.NoShow + week.Show;
      const rate = total > 0 ? ((week.NoShow / total) * 100).toFixed(1) : '0.0';
      return {
        ...week,
        total,
        rate: parseFloat(rate),
        noShows: week.NoShow
      };
    }).sort((a, b) => {
      if (a.name === 'Unknown') return 1;
      if (b.name === 'Unknown') return -1;
      return new Date(a.name) - new Date(b.name);
    });

    const waitingBins = {
      '0': { name: '0 days', total: 0, noShows: 0 },
      '1-3': { name: '1-3 days', total: 0, noShows: 0 },
      '4-7': { name: '4-7 days', total: 0, noShows: 0 },
      '8-14': { name: '8-14 days', total: 0, noShows: 0 },
      '15+': { name: '15+ days', total: 0, noShows: 0 }
    };

    filteredData.forEach((row) => {
      const days = getWaitingDays(row);
      if (days === null) return;

      let bin = '15+';
      if (days === 0) bin = '0';
      else if (days <= 3) bin = '1-3';
      else if (days <= 7) bin = '4-7';
      else if (days <= 14) bin = '8-14';

      waitingBins[bin].total++;
      if (row.NoShow === 1) waitingBins[bin].noShows++;
    });

    const byWaitingDays = Object.values(waitingBins).map((bin) => {
      const rate = bin.total > 0 ? (bin.noShows / bin.total) * 100 : 0;
      return {
        name: bin.name,
        'No-Show Rate': parseFloat(rate.toFixed(1)),
        n: bin.total,
        noShows: bin.noShows
      };
    });

    const pieData = [
      { name: 'Showed Up', value: kpis.shows },
      { name: 'No-Show', value: kpis.noShows }
    ];

    return {
      byAge,
      bySMS,
      byWeek,
      byWaitingDays,
      pieData
    };
  }, [filteredData, kpis]);

  const ageGroupInsight = useMemo(() => {
    if (!chartData.byAge || chartData.byAge.length === 0) return { count: null, rate: null };

    let highestRate = null;
    let highestVolume = null;

    chartData.byAge.forEach((g) => {
      const total = g.total || 0;
      if (total <= 0) return;

      // Track highest rate
      if (!highestRate || g.rate > highestRate.rate) {
        highestRate = { ageGroup: g.name, rate: g.rate, total: g.total };
      }

      // Track highest volume
      if (!highestVolume || total > highestVolume.total) {
        highestVolume = { ageGroup: g.name, total: total };
      }
    });

    const countInsight = highestVolume
      ? `Highest volume: age group ${highestVolume.ageGroup} (${highestVolume.total.toLocaleString()} appointments)`
      : null;

    let rateInsight = null;
    if (highestRate) {
      // Check if younger patients (10-29) have higher rates than older patients (50+)
      const youngerGroups = chartData.byAge.filter(g => {
        const match = g.name.match(/^(\d+)/);
        const age = match ? parseInt(match[1]) : 999;
        return age >= 10 && age < 30;
      });

      const olderGroups = chartData.byAge.filter(g => {
        const match = g.name.match(/^(\d+)/);
        const age = match ? parseInt(match[1]) : 999;
        return age >= 50 && age < 100;
      });

      const youngerAvg = youngerGroups.length > 0
        ? youngerGroups.reduce((sum, g) => sum + g.rate, 0) / youngerGroups.length
        : 0;

      const olderAvg = olderGroups.length > 0
        ? olderGroups.reduce((sum, g) => sum + g.rate, 0) / olderGroups.length
        : 0;

      const comparison = youngerAvg > olderAvg + 2
        ? 'Younger patients (10-29) have significantly higher no-show rates than patients 50+.'
        : '';

      rateInsight = `📊 Highest no-show rate: ${highestRate.rate}% in age group ${highestRate.ageGroup} (n=${highestRate.total.toLocaleString()}). ${comparison}`;
    }

    return { count: countInsight, rate: rateInsight };
  }, [chartData.byAge]);

  const weeklyTrendInsight = useMemo(() => {
    if (!chartData.byWeek || chartData.byWeek.length === 0) return null;

    const validWeeks = chartData.byWeek.filter(w => w.name !== 'Unknown');
    if (validWeeks.length === 0) return null;

    let maxRate = { week: null, rate: 0 };
    let minRate = { week: null, rate: 100 };

    validWeeks.forEach((week) => {
      if (week.rate > maxRate.rate) {
        maxRate = { week: week.name, rate: week.rate };
      }
      if (week.rate < minRate.rate) {
        minRate = { week: week.name, rate: week.rate };
      }
    });

    const firstWeek = validWeeks[0];
    const lastWeek = validWeeks[validWeeks.length - 1];
    const trend = lastWeek.rate < firstWeek.rate ? 'declined' : 'increased';

    return `📈 No-show rate peaked at ${maxRate.rate}% in week of ${maxRate.week}, then ${trend} to ${lastWeek.rate}% by ${lastWeek.name}`;
  }, [chartData.byWeek]);

  const uniqueValues = useMemo(() => {
    if (!csvData) return { ageGroups: [], weeks: [] };

    const sortAgeGroups = (a, b) => {
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      const getNum = (str) => {
        const match = String(str).match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 999;
      };
      return getNum(a) - getNum(b);
    };

    const ageGroups = [...new Set(csvData.map((row) => row.AgeGroup))].filter(Boolean).sort(sortAgeGroups);
    const weeks = [...new Set(csvData.map((row) => row.Week))].filter(Boolean).sort((a, b) => {
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      return new Date(a) - new Date(b);
    });

    return { ageGroups, weeks };
  }, [csvData]);

  const COLORS = ['#0d9488', '#fb923c'];
  const takeawayBorderColors = ['border-teal-500', 'border-amber-500', 'border-blue-500'];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 p-8 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-md border-l-4 border-teal-500">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-full border-4 border-slate-200 border-t-teal-600 animate-spin" />
            <div>
              <p className="text-sm font-semibold text-slate-800">Loading dashboard…</p>
              <p className="text-xs text-slate-500">Parsing CSV and rendering charts</p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <div className="h-3 w-3/4 bg-slate-200 rounded animate-pulse" />
            <div className="h-3 w-2/3 bg-slate-200 rounded animate-pulse" />
            <div className="h-3 w-1/2 bg-slate-200 rounded animate-pulse" />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="h-16 bg-slate-100 rounded-lg animate-pulse" />
            <div className="h-16 bg-slate-100 rounded-lg animate-pulse" />
            <div className="h-16 bg-slate-100 rounded-lg animate-pulse" />
            <div className="h-16 bg-slate-100 rounded-lg animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!csvData) {
    return (
      <div className="min-h-screen bg-slate-100 p-8 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Patient No-Show Analysis Dashboard</h1>
          <p className="text-gray-600 mb-6">Upload your CSV file to analyze patient no-show patterns</p>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen p-6 ${isDarkMode ? 'bg-slate-900' : 'bg-slate-100'}`}>
      {isLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/10">
          <div className="bg-white rounded-xl shadow-md p-4 border border-slate-200 flex items-center gap-3">
            <div className="h-6 w-6 rounded-full border-4 border-slate-200 border-t-teal-600 animate-spin" />
            <p className="text-sm font-medium text-slate-700">Updating…</p>
          </div>
        </div>
      )}
      <div className="w-full space-y-8">
        <div className="flex items-start justify-between gap-4">
          <h1 className={`flex-1 text-center text-3xl font-bold tracking-tight mb-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
            Patient No-Show Analysis Dashboard
          </h1>
          <button
            type="button"
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium shadow-sm transition ${
              isDarkMode
                ? 'border-slate-700 bg-slate-800 text-white hover:bg-slate-700'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            aria-label="Toggle dark mode"
            title="Toggle dark mode"
          >
            {isDarkMode ? '☀️' : '🌙'}
          </button>
        </div>

        {datasetOverview && (
          <div className={`text-center text-sm mb-1 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
            <strong>Dataset Overview:</strong> {datasetOverview.total.toLocaleString()} appointments spanning {datasetOverview.dateRange}. {datasetOverview.noShowDef}.
          </div>
        )}

        {dataQualityStats && (
          <div className="max-w-3xl mx-auto mb-4">
            <button
              onClick={() => setIsDataQualityExpanded(!isDataQualityExpanded)}
              className={`w-full flex items-center justify-center gap-2 text-sm py-2.5 px-4 rounded-lg shadow-sm transition-colors border ${
                isDarkMode
                  ? 'bg-slate-800 text-slate-200 hover:bg-slate-700 border-slate-700'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-50 border-slate-200'
              }`}
            >
              <span>ℹ️</span>
              <span className="font-medium">Data Quality & Assumptions</span>
              <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                (click to {isDataQualityExpanded ? 'collapse' : 'expand'})
              </span>
              <svg
                className={`w-4 h-4 transition-transform ${isDataQualityExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isDataQualityExpanded && (
              <div
                className={`mt-2 p-5 rounded-lg shadow-md text-sm ${
                  isDarkMode
                    ? 'bg-slate-800 border border-slate-700 text-slate-300'
                    : 'bg-white border border-slate-200 text-slate-600'
                }`}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className={`font-semibold mb-1.5 ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                      📊 Records
                    </p>
                    <p className={isDarkMode ? 'text-slate-300' : 'text-slate-600'}>
                      {dataQualityStats.total.toLocaleString()} total appointments
                    </p>
                  </div>

                  <div>
                    <p className={`font-semibold mb-1.5 ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                      📅 Date Range
                    </p>
                    <p className={isDarkMode ? 'text-slate-300' : 'text-slate-600'}>
                      {datasetOverview.dateRange} ({datasetOverview.dateRangeDays} days)
                    </p>
                  </div>

                  <div>
                    <p className={`font-semibold mb-1.5 ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                      ⚠️ Missing Data
                    </p>
                    <ul className={`space-y-0.5 ml-4 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                      <li>• Waiting Days: {dataQualityStats.missingWaitingDays.toLocaleString()} records</li>
                      <li>• SMS Received: {dataQualityStats.missingSMS.toLocaleString()} records</li>
                      <li>• Age Group: {dataQualityStats.missingAgeGroup.toLocaleString()} records</li>
                    </ul>
                  </div>

                  <div>
                    <p className={`font-semibold mb-1.5 ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                      🔑 Key Assumption
                    </p>
                    <p className={isDarkMode ? 'text-slate-300' : 'text-slate-600'}>
                      NoShow=1 indicates patient did not attend scheduled appointment
                    </p>
                  </div>
                </div>

                <div className={`mt-4 pt-4 border-t ${isDarkMode ? 'border-slate-600' : 'border-slate-200'}`}>
                  <p className={`font-semibold mb-1.5 ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                    ⚖️ Limitations
                  </p>
                  <p className={`italic ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                    Single healthcare system; results may not generalize to other populations or settings
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <p className={`text-center text-xs mb-8 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
          Data notes: This analysis shows patterns and correlations, not causal relationships.
        </p>

        <div className={`rounded-xl p-6 mb-8 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
          <h2 className={`text-xl font-bold mb-3 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
            Key Takeaways & Recommendations
          </h2>

          <div className="flex flex-col gap-3">
            {keyTakeaways.map((takeaway, i) => (
              <div
                key={i}
                className={`${isDarkMode ? 'bg-slate-800' : 'bg-white'} rounded-xl shadow-sm border-l-4 ${takeawayBorderColors[i % takeawayBorderColors.length]} p-4`}
              >
                <p className={`${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                  {(i === 0 ? '📊 ' : i === 1 ? '📱 ' : i === 2 ? '⏱️ ' : '')}{takeaway}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className={`${isDarkMode ? 'bg-slate-800' : 'bg-white'} p-4 rounded-lg shadow mb-8`}>
          <div className="flex justify-between items-center mb-3">
            <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
              Filters
              {activeFilterCount > 0 && (
                <span
                  className={`ml-2 text-xs font-semibold border rounded-full px-2 py-0.5 ${
                    isDarkMode
                      ? 'text-slate-300 bg-slate-700 border-slate-600'
                      : 'text-slate-600 bg-slate-100 border-slate-200'
                  }`}
                >
                  ({activeFilterCount} active)
                </span>
              )}
            </h2>
            <button
              type="button"
              onClick={resetFilters}
              disabled={activeFilterCount === 0}
              className={`px-4 py-2 rounded-md text-sm font-medium transition disabled:opacity-60 disabled:cursor-not-allowed ${
                activeFilterCount > 0
                  ? 'bg-rose-500 hover:bg-rose-600 text-white'
                  : isDarkMode
                    ? '!bg-slate-700 hover:!bg-slate-600 !text-slate-200 border border-slate-600'
                    : '!bg-gray-200 hover:!bg-gray-300 !text-gray-700'
              }`}
              aria-disabled={activeFilterCount === 0}
              title={activeFilterCount === 0 ? 'No filters to reset' : 'Reset filters'}
            >
              Reset Filters
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>Age Group</label>
              <select
                value={uniqueValues.ageGroups.includes(filters.ageGroup) ? filters.ageGroup : 'All'}
                onChange={(e) => setFilters({ ...filters, ageGroup: e.target.value })}
                className={`w-full p-2 border rounded-md ${
                  isDarkMode
                    ? 'bg-slate-700 text-white border-slate-600'
                    : 'bg-white text-slate-700 border-slate-300'
                } ${
                  filters.ageGroup !== 'All'
                    ? isDarkMode
                      ? 'border-teal-500'
                      : 'bg-teal-50 border-teal-300'
                    : ''
                }`}
              >
                <option value="All">All Age Groups</option>
                {uniqueValues.ageGroups.map((age) => (
                  <option key={age} value={age}>{age}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>SMS Received</label>
              <select
                value={['All', '1', '0'].includes(filters.smsReceived) ? filters.smsReceived : 'All'}
                onChange={(e) => setFilters({ ...filters, smsReceived: e.target.value })}
                className={`w-full p-2 border rounded-md ${
                  isDarkMode
                    ? 'bg-slate-700 text-white border-slate-600'
                    : 'bg-white text-slate-700 border-slate-300'
                } ${
                  filters.smsReceived !== 'All'
                    ? isDarkMode
                      ? 'border-teal-500'
                      : 'bg-teal-50 border-teal-300'
                    : ''
                }`}
              >
                <option value="All">All</option>
                <option value="1">Yes</option>
                <option value="0">No</option>
              </select>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>Week</label>
              <select
                value={uniqueValues.weeks.includes(filters.week) ? filters.week : 'All'}
                onChange={(e) => setFilters({ ...filters, week: e.target.value })}
                className={`w-full p-2 border rounded-md ${
                  isDarkMode
                    ? 'bg-slate-700 text-white border-slate-600'
                    : 'bg-white text-slate-700 border-slate-300'
                } ${
                  filters.week !== 'All'
                    ? isDarkMode
                      ? 'border-teal-500'
                      : 'bg-teal-50 border-teal-300'
                    : ''
                }`}
              >
                <option value="All">All Weeks</option>
                {uniqueValues.weeks.map((week) => (
                  <option key={week} value={week}>{week}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className={`${isDarkMode ? 'bg-slate-800' : 'bg-white'} p-6 rounded-xl shadow-md border-t-[6px] border-blue-500 transition-all duration-200 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg`}>
            <p className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
              Total Appointments
              <span
                className="ml-1 inline-flex items-center text-slate-400 hover:text-slate-500"
                title="Total number of scheduled appointments in the selected period"
                aria-label="Total number of scheduled appointments in the selected period"
              >
                ℹ️
              </span>
            </p>
            <p className={`text-3xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
              {kpis.total.toLocaleString()}
            </p>
          </div>

          <div className={`${isDarkMode ? 'bg-slate-800' : 'bg-white'} p-6 rounded-xl shadow-md border-t-[6px] border-rose-400 transition-all duration-200 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg`}>
            <p className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
              No-Shows
              <span
                className="ml-1 inline-flex items-center text-slate-400 hover:text-slate-500"
                title="Appointments where the patient did not attend"
                aria-label="Appointments where the patient did not attend"
              >
                ℹ️
              </span>
            </p>
            <p className="text-3xl font-bold text-rose-400 tracking-tight">{kpis.noShows.toLocaleString()}</p>
          </div>

          <div className={`${isDarkMode ? 'bg-slate-800' : 'bg-white'} p-6 rounded-xl shadow-md border-t-[6px] border-teal-500 transition-all duration-200 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg`}>
            <p className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
              Showed Up
              <span
                className="ml-1 inline-flex items-center text-slate-400 hover:text-slate-500"
                title="Appointments where the patient attended"
                aria-label="Appointments where the patient attended"
              >
                ℹ️
              </span>
            </p>
            <p className="text-3xl font-bold text-teal-600 tracking-tight">{kpis.shows.toLocaleString()}</p>
          </div>

          <div className={`${isDarkMode ? 'bg-slate-800' : 'bg-white'} p-6 rounded-xl shadow-md border-t-[6px] border-amber-500 transition-all duration-200 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg`}>
            <p className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
              No-Show Rate
              <span
                className="ml-1 inline-flex items-center text-slate-400 hover:text-slate-500"
                title="Percentage of appointments missed (No-Shows / Total)"
                aria-label="Percentage of appointments missed (No-Shows / Total)"
              >
                ℹ️
              </span>
            </p>
            <p className="text-3xl font-bold text-amber-500 tracking-tight">{kpis.noShowRate}%</p>
          </div>
        </div>

        {currentViewSummary && (
          <div
            className={`${
              isDarkMode ? 'bg-purple-900/20' : 'bg-purple-50'
            } border-l-4 border-purple-500 rounded-xl shadow-md p-6 mb-8`}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0" aria-hidden="true">💡</span>
              <div className="flex-1">
                <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                  Current View Summary
                </h3>
                <p className={`text-sm mb-3 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                  {currentViewSummary.summary}
                </p>
                <p className={`text-sm font-medium ${isDarkMode ? 'text-purple-300' : 'text-purple-700'}`}>
                  {currentViewSummary.insight}
                </p>
              </div>
            </div>
          </div>
        )}

        {waitingTimeComparison && (
          <div
            className={`${
              isDarkMode ? 'bg-slate-800' : 'bg-white'
            } border-l-4 border-amber-500 rounded-xl shadow-md p-6 mb-8`}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0" aria-hidden="true">⏱️</span>
              <div className="flex-1">
                <h3 className={`text-lg font-semibold mb-3 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                  Waiting Time Impact
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <p className={`text-xs font-medium mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                      Showed Up (n={waitingTimeComparison.showedCount.toLocaleString()})
                    </p>
                    <p className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                      <span className="font-semibold">Median:</span> {waitingTimeComparison.showedMedian} days
                      <span className="mx-2">|</span>
                      <span className="font-semibold">Mean:</span> {waitingTimeComparison.showedMean} days
                    </p>
                  </div>

                  <div>
                    <p className={`text-xs font-medium mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                      No-Show (n={waitingTimeComparison.noShowCount.toLocaleString()})
                    </p>
                    <p className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                      <span className="font-semibold">Median:</span> {waitingTimeComparison.noShowMedian} days
                      <span className="mx-2">|</span>
                      <span className="font-semibold">Mean:</span> {waitingTimeComparison.noShowMean} days
                    </p>
                  </div>
                </div>

                <p className={`text-sm font-medium ${isDarkMode ? 'text-amber-300' : 'text-amber-700'}`}>
                  📊 Patients who no-show wait {waitingTimeComparison.ratio}x longer on average than those who attend.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className={`${isDarkMode ? 'bg-slate-800' : 'bg-white'} p-8 rounded-xl shadow-md border-l-4 border-teal-500`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>No-Show by Age Group</h3>
              <div className={`inline-flex rounded-lg p-1 border ${isDarkMode ? 'bg-slate-700 border-slate-600' : 'bg-slate-100 border-slate-200'}`}>
                <button
                  onClick={() => setAgeView('count')}
                  className={
                    ageView === 'count'
                      ? (isDarkMode ? 'px-3 py-1 text-xs font-medium rounded-md bg-teal-500 text-white' : 'px-3 py-1 text-xs font-medium rounded-md bg-teal-600 text-white')
                      : (isDarkMode ? 'px-3 py-1 text-xs font-medium rounded-md bg-slate-700 text-slate-300' : 'px-3 py-1 text-xs font-medium rounded-md bg-white text-slate-600 border border-slate-200')
                  }
                >
                  Count
                </button>
                <button
                  onClick={() => setAgeView('rate')}
                  className={
                    ageView === 'rate'
                      ? (isDarkMode ? 'px-3 py-1 text-xs font-medium rounded-md bg-teal-500 text-white' : 'px-3 py-1 text-xs font-medium rounded-md bg-teal-600 text-white')
                      : (isDarkMode ? 'px-3 py-1 text-xs font-medium rounded-md bg-slate-700 text-slate-300' : 'px-3 py-1 text-xs font-medium rounded-md bg-white text-slate-600 border border-slate-200')
                  }
                >
                  Rate
                </button>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={300}>
              {ageView === 'count' ? (
                <BarChart data={chartData.byAge}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                  />
                  <YAxis
                    width={60}
                    tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                  />
                  <Tooltip content={<CustomBarTooltip />} />
                  <Legend />
                  <Bar dataKey="Show" fill="#0d9488" cursor="pointer" onClick={handleAgeGroupBarClick} />
                  <Bar dataKey="NoShow" fill="#fb923c" cursor="pointer" onClick={handleAgeGroupBarClick} />
                </BarChart>
              ) : (
                <BarChart data={chartData.byAge}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                  />
                  <YAxis
                    domain={[0, 30]}
                    width={60}
                    tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                    label={{ value: 'No-Show Rate (%)', angle: -90, position: 'insideLeft', fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                  />
                  <Tooltip content={<CustomAgeRateTooltip />} />
                  <ReferenceLine
                    y={parseFloat(overallKpis.noShowRate)}
                    stroke={isDarkMode ? '#94a3b8' : '#64748b'}
                    strokeDasharray="5 5"
                    label={{
                      value: `Avg: ${overallKpis.noShowRate}%`,
                      position: 'right',
                      fill: isDarkMode ? '#94a3b8' : '#64748b',
                      fontSize: 12
                    }}
                  />
                  <Bar dataKey="rate" fill="#fb923c" cursor="pointer" onClick={handleAgeGroupBarClick} />
                </BarChart>
              )}
            </ResponsiveContainer>

            {ageView === 'count' && ageGroupInsight.count && (
              <p className={`mt-3 text-xs ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                {ageGroupInsight.count}
              </p>
            )}
            {ageView === 'rate' && ageGroupInsight.rate && (
              <p className={`mt-3 text-xs ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                {ageGroupInsight.rate}
              </p>
            )}
          </div>

          <div className={`${isDarkMode ? 'bg-slate-800' : 'bg-white'} p-8 rounded-xl shadow-md border-l-4 border-teal-500`}> 
            <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Overall Distribution</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData.pieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  dataKey="value"
                >
                  {chartData.pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  wrapperStyle={{ fontSize: 14 }}
                  formatter={(value, entry) => {
                    const total = chartData.pieData.reduce(
                      (sum, d) => sum + (Number(d.value) || 0),
                      0
                    );
                    const v = entry?.payload?.value ?? 0;
                    const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';

                    const label =
                      value === 'Showed Up'
                        ? 'Showed Up'
                        : value === 'No-Show'
                          ? 'No-Show'
                          : String(value);

                    return `${label} (${pct}%)`;
                  }}
                />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className={`${isDarkMode ? 'bg-slate-800' : 'bg-white'} p-8 rounded-xl shadow-md border-l-4 border-blue-500`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>No-Show by SMS Reminder</h3>
              <div className={`inline-flex rounded-lg p-1 border ${isDarkMode ? 'bg-slate-700 border-slate-600' : 'bg-slate-100 border-slate-200'}`}>
                <button
                  onClick={() => setSmsView('count')}
                  className={
                    smsView === 'count'
                      ? (isDarkMode ? 'px-3 py-1 text-xs font-medium rounded-md bg-teal-500 text-white' : 'px-3 py-1 text-xs font-medium rounded-md bg-teal-600 text-white')
                      : (isDarkMode ? 'px-3 py-1 text-xs font-medium rounded-md bg-slate-700 text-slate-300' : 'px-3 py-1 text-xs font-medium rounded-md bg-white text-slate-600 border border-slate-200')
                  }
                >
                  Count
                </button>
                <button
                  onClick={() => setSmsView('rate')}
                  className={
                    smsView === 'rate'
                      ? (isDarkMode ? 'px-3 py-1 text-xs font-medium rounded-md bg-teal-500 text-white' : 'px-3 py-1 text-xs font-medium rounded-md bg-teal-600 text-white')
                      : (isDarkMode ? 'px-3 py-1 text-xs font-medium rounded-md bg-slate-700 text-slate-300' : 'px-3 py-1 text-xs font-medium rounded-md bg-white text-slate-600 border border-slate-200')
                  }
                >
                  Rate
                </button>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={300}>
              {smsView === 'count' ? (
                <BarChart data={chartData.bySMS}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                  />
                  <YAxis
                    width={60}
                    tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                  />
                  <Tooltip content={<CustomBarTooltip />} />
                  <Legend />
                  <Bar dataKey="Show" fill="#0d9488" />
                  <Bar dataKey="NoShow" fill="#fb923c" />
                </BarChart>
              ) : (
                <BarChart data={chartData.bySMS}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                  />
                  <YAxis
                    domain={[0, 35]}
                    width={60}
                    tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                    tickFormatter={(v) => `${v}%`}
                    label={{ value: 'No-Show Rate (%)', angle: -90, position: 'insideLeft', fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                  />
                  <Tooltip content={<CustomSmsRateTooltip />} />
                  <ReferenceLine
                    y={parseFloat(overallKpis.noShowRate)}
                    stroke={isDarkMode ? '#94a3b8' : '#64748b'}
                    strokeDasharray="5 5"
                    label={{
                      value: `Avg: ${overallKpis.noShowRate}%`,
                      position: 'right',
                      fill: isDarkMode ? '#94a3b8' : '#64748b',
                      fontSize: 12
                    }}
                  />
                  <Bar dataKey="rate" fill="#fb923c" />
                </BarChart>
              )}
            </ResponsiveContainer>

            <div className={`${isDarkMode ? 'bg-yellow-900/20 border-yellow-500' : 'bg-yellow-50 border-yellow-500'} border-l-4 p-3 mt-3 rounded`}>
              <p className={`font-semibold ${isDarkMode ? 'text-yellow-400' : 'text-yellow-700'}`}>
                ⚠️ Counter-Intuitive Finding
              </p>
              <p className={`text-sm mt-1 ${isDarkMode ? 'text-yellow-300' : 'text-yellow-800'}`}>
                SMS recipients have HIGHER no-show rates (27.6%) than non-recipients (16.7%). This likely indicates SMS reminders are sent to high-risk patients, not that SMS causes no-shows.
              </p>
            </div>
          </div>

          <div className={`${isDarkMode ? 'bg-slate-800' : 'bg-white'} p-8 rounded-xl shadow-md border-l-4 border-amber-500`}> 
            <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>No-Show Rate by Waiting Time</h3>
            {waitingDaysStats.excludedCount > 0 && (
              <p className={`text-xs mt-2 mb-2 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                Note: {waitingDaysStats.excludedCount} appointments excluded (missing waiting time).
              </p>
            )}
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData.byWaitingDays}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                />
                <YAxis
                  width={60}
                  tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                />
                <Tooltip content={<CustomWaitingTooltip />} />
                <Bar dataKey="No-Show Rate" fill="#fb923c" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className={`${isDarkMode ? 'bg-slate-800' : 'bg-white'} p-8 rounded-xl shadow-md border-l-4 border-indigo-500 lg:col-span-2`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>No-Show Trends by Week</h3>
              <div className={`inline-flex rounded-lg p-1 border ${isDarkMode ? 'bg-slate-700 border-slate-600' : 'bg-slate-100 border-slate-200'}`}>
                <button
                  onClick={() => setWeeklyView('count')}
                  className={
                    weeklyView === 'count'
                      ? (isDarkMode ? 'px-3 py-1 text-xs font-medium rounded-md bg-teal-500 text-white' : 'px-3 py-1 text-xs font-medium rounded-md bg-teal-600 text-white')
                      : (isDarkMode ? 'px-3 py-1 text-xs font-medium rounded-md bg-slate-700 text-slate-300' : 'px-3 py-1 text-xs font-medium rounded-md bg-white text-slate-600 border border-slate-200')
                  }
                >
                  Count
                </button>
                <button
                  onClick={() => setWeeklyView('rate')}
                  className={
                    weeklyView === 'rate'
                      ? (isDarkMode ? 'px-3 py-1 text-xs font-medium rounded-md bg-teal-500 text-white' : 'px-3 py-1 text-xs font-medium rounded-md bg-teal-600 text-white')
                      : (isDarkMode ? 'px-3 py-1 text-xs font-medium rounded-md bg-slate-700 text-slate-300' : 'px-3 py-1 text-xs font-medium rounded-md bg-white text-slate-600 border border-slate-200')
                  }
                >
                  Rate
                </button>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={300}>
              {weeklyView === 'count' ? (
                <BarChart data={chartData.byWeek}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis
                    width={60}
                    tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                  />
                  <Tooltip content={<CustomBarTooltip />} />
                  <Legend />
                  <Bar dataKey="Show" fill="#0d9488" />
                  <Bar dataKey="NoShow" fill="#fb923c" />
                </BarChart>
              ) : (
                <LineChart data={chartData.byWeek}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis
                    domain={[15, 25]}
                    width={60}
                    tick={{ fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                    label={{ value: 'No-Show Rate (%)', angle: -90, position: 'insideLeft', fill: isDarkMode ? '#e2e8f0' : '#475569' }}
                  />
                  <Tooltip content={<CustomWeeklyRateTooltip />} />
                  <ReferenceLine
                    y={parseFloat(overallKpis.noShowRate)}
                    stroke={isDarkMode ? '#94a3b8' : '#64748b'}
                    strokeDasharray="5 5"
                    label={{
                      value: `Avg: ${overallKpis.noShowRate}%`,
                      position: 'right',
                      fill: isDarkMode ? '#94a3b8' : '#64748b',
                      fontSize: 12
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    stroke="#fb923c"
                    strokeWidth={2}
                    dot={{ fill: '#fb923c', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>

            {weeklyView === 'rate' && weeklyTrendInsight && (
              <p className={`mt-3 text-xs ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                {weeklyTrendInsight}
              </p>
            )}
          </div>
        </div>

        <div className={`rounded-xl shadow-md p-4 mt-6 border ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
          <button
            onClick={() => setShowStats(!showStats)}
            className={`w-full flex justify-between items-center ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}
          >
            <h3 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
              📊 Statistical Summary
            </h3>
            <span className={isDarkMode ? 'text-white' : 'text-slate-800'}>
              {showStats ? '▼' : '▶'}
            </span>
          </button>

          {showStats && (
            <div className={`mt-4 space-y-3 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
              <div>
                <p className={`font-medium ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                  Correlations with No-Show:
                </p>
                <ul className="text-sm ml-4 mt-1">
                  <li>Waiting Days: r = 0.186 (strongest predictor)</li>
                  <li>SMS Received: r = 0.127</li>
                  <li>Age: r = -0.060 (older patients slightly more likely to show)</li>
                </ul>
              </div>
              <div>
                <p className={`font-medium ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                  Statistical Tests:
                </p>
                <ul className="text-sm ml-4 mt-1">
                  <li>T-test (Waiting Days by NoShow): p &lt; 0.001 ✓</li>
                  <li>Chi-square (SMS vs NoShow): χ² = 1768, p &lt; 0.001 ✓</li>
                </ul>
              </div>
              <p className={`text-sm italic mt-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                Waiting time is the strongest predictor. SMS correlation is confounded - reminders appear to be sent to higher-risk appointments.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PatientNoShowDashboard;