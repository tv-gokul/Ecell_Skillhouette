import React, { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import { mockParticipants } from "./utils/mockData";
import { fetchLeaderboardData } from "./utils/sheets";
import { useAudio } from "./hooks/useAudio";
import Header from "./components/Header";
import Podium from "./components/Podium";
import TableList from "./components/TableList";
import ToastContainer from "./components/Toast";
import { Award, Play } from "lucide-react";

// Default settings
const DEFAULT_CONFIG = {
  sheetUrlOrId: "https://docs.google.com/spreadsheets/d/1p3PH2fY5K9X6YRQyKyz7w7-kaL4TrrfGjpvBJntocdU/edit?gid=1512161882#gid=1512161882",
  eventName: "skillhouette leaderboard",
  logoUrl: "",
  refreshInterval: 10, // seconds
  autoScrollEnabled: false,
  autoScrollSpeed: 2,
  soundEnabled: true,
  isDemoMode: false
};

function rankAndSortParticipants(data) {
  // Sort descending by points
  const sorted = [...data].sort((a, b) => b.points - a.points);
  
  let currentRank = 0;
  let lastPoints = null;

  const ranked = sorted.map((player, idx) => {
    // If first player or points are different from previous, update rank to standard competition rank
    if (idx === 0 || player.points !== lastPoints) {
      currentRank = idx + 1;
      lastPoints = player.points;
    }
    return { ...player, rank: currentRank };
  });

  return ranked;
}

export default function App() {
  // ----------------------------------------------------
  // States
  // ----------------------------------------------------
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem("leaderboard_config");
    return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
  });

  const [participants, setParticipants] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState(100);
  const [error, setError] = useState(null);
  

  
  // Native Fullscreen tracking
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Toasts stack
  const [toasts, setToasts] = useState([]);

  // Diff engine states (used to trigger visual rank-up highlights)
  const [rankChanges, setRankChanges] = useState({});

  // Audio synthethizer hook
  const { playRankUp, playTop3Entry, playClick, initAudio } = useAudio();

  // Refs for tracking timer and previous state values
  const prevParticipantsRef = useRef([]);
  const timerRef = useRef(null);
  const timeStartedRef = useRef(null);

  // ----------------------------------------------------
  // Toast Helper
  // ----------------------------------------------------
  const addToast = useCallback((title, message, type = "info", duration = 4000, position = "bottom-right", submessage = "") => {
    const id = Date.now() + Math.random().toString(36).substring(2, 7);
    setToasts((prev) => [...prev, { id, title, message, type, duration, position, submessage }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ----------------------------------------------------
  // Core Data Ingestion & Comparison Engine (Diff Engine)
  // ----------------------------------------------------
  const LOCKED_SHEET_URL = "https://docs.google.com/spreadsheets/d/1p3PH2fY5K9X6YRQyKyz7w7-kaL4TrrfGjpvBJntocdU/edit?gid=1512161882#gid=1512161882";

  const loadData = useCallback(async (isManual = false) => {
    setIsRefreshing(true);
    setError(null);
    try {
      // Fetch directly from the internally locked Google Sheet URL
      const freshData = await fetchLeaderboardData({
        sheetUrlOrId: LOCKED_SHEET_URL
      });

      // Rank & sort
      const newRanked = rankAndSortParticipants(freshData);

      // Perform Diff Analysis against previous data
      const prevRanked = prevParticipantsRef.current;
      if (prevRanked.length > 0) {
        const prevRankMap = {};
        prevRanked.forEach((p) => {
          prevRankMap[p.name] = p.rank;
        });

        const newRankChanges = {};
        let triggeredCelebration = false;
        let triggeredRankUp = false;

        newRanked.forEach((p) => {
          const oldRank = prevRankMap[p.name];
          if (oldRank !== undefined) {
            const rankDelta = oldRank - p.rank; // positive means rank went up (e.g. 5th -> 2nd)
            
            // Check if rank increased
            if (rankDelta > 0) {
              newRankChanges[p.name] = rankDelta;
              
              // Case 1: Entered Top 3!
              if (oldRank > 3 && p.rank <= 3) {
                triggeredCelebration = true;
                addToast(
                  "🏆 Podium Promotion!",
                  `${p.name} climbed to Rank #${p.rank}!`,
                  "top3",
                  6000,
                  "top-center",
                  `ID No: ${p.department} • ${p.points.toLocaleString()} PTS`
                );
              } 
              // Case 2: General Rank Up
              else {
                triggeredRankUp = true;
              }
            }
          } else {
            // New participant entered. If they debut in top 3, celebrate!
            if (p.rank <= 3) {
              triggeredCelebration = true;
              addToast(
                "🏆 Podium Debut!",
                `${p.name} entered the board at Rank #${p.rank}!`,
                "top3",
                6000,
                "top-center",
                `ID No: ${p.department} • ${p.points.toLocaleString()} PTS`
              );
            }
          }
        });

        // Trigger confetti, sounds, and UI flashes
        if (triggeredCelebration) {
          // Play fanfare sound
          playTop3Entry(config.soundEnabled);
          // Explode confetti
          confetti({
            particleCount: 150,
            spread: 80,
            origin: { y: 0.55 }
          });
        } else if (triggeredRankUp) {
          // Play rank up sound
          playRankUp(config.soundEnabled);
        }

        // Apply visual rank changes (highlight rows)
        if (Object.keys(newRankChanges).length > 0) {
          setRankChanges(newRankChanges);
          // Remove highlights after 5 seconds
          setTimeout(() => {
            setRankChanges({});
          }, 5000);
        }
      }

      setParticipants(newRanked);
      prevParticipantsRef.current = newRanked;
      setLastUpdated(new Date());
      
      if (isManual) {
        addToast("Sync Completed", "Standings successfully synchronized with data source.", "success");
      }
    } catch (err) {
      console.error(err);
      setError(err.message);
      addToast("Connection Alert", err.message, "error");
    } finally {
      setIsRefreshing(false);
      // Reset timer
      timeStartedRef.current = Date.now();
    }
  }, [config.isDemoMode, config.sheetUrlOrId, config.soundEnabled, addToast, playRankUp, playTop3Entry]);

  // ----------------------------------------------------
  // Timer & Auto-Refresh Thread (requestAnimationFrame)
  // ----------------------------------------------------
  useEffect(() => {
    // Initial fetch
    loadData();

    // Setup requestAnimationFrame loop for smooth timer progress bar
    timeStartedRef.current = Date.now();
    const intervalMs = config.refreshInterval * 1000;

    const checkTimer = () => {
      if (isRefreshing) {
        timeStartedRef.current = Date.now(); // reset if actively loading
      }

      const elapsed = Date.now() - timeStartedRef.current;
      const remainingPct = Math.max(0, 100 - (elapsed / intervalMs) * 100);
      setRefreshProgress(remainingPct);

      if (elapsed >= intervalMs) {
        loadData();
      } else {
        timerRef.current = requestAnimationFrame(checkTimer);
      }
    };

    timerRef.current = requestAnimationFrame(checkTimer);

    return () => {
      if (timerRef.current) {
        cancelAnimationFrame(timerRef.current);
      }
    };
  }, [loadData, config.refreshInterval, isRefreshing]);

  // ----------------------------------------------------
  // Fullscreen Sync Handlers
  // ----------------------------------------------------
  const handleToggleFullscreen = () => {
    initAudio(); // Unlocks audio context on user interaction
    playClick(config.soundEnabled);

    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        addToast("Fullscreen Error", "Failed to enter fullscreen mode.", "error");
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // ----------------------------------------------------
  // Action Handlers
  // ----------------------------------------------------
  const handleSaveConfig = (newConfig) => {
    playClick(newConfig.soundEnabled);
    setConfig(newConfig);
    localStorage.setItem("leaderboard_config", JSON.stringify(newConfig));
    addToast("Settings Updated", "Configuration changes saved successfully.", "success");
  };

  const handleManualRefresh = () => {
    initAudio();
    playClick(config.soundEnabled);
    loadData(true);
  };

  // Opens the settings (placeholder)
  const handleOpenSettings = () => {
    // Play click and show a toast until a settings modal is implemented
    playClick(config.soundEnabled);
    addToast("Settings", "Settings modal is not implemented yet.", "info");
  };



  // ----------------------------------------------------
  // Layout Variables
  // ----------------------------------------------------
  const topThree = participants.slice(0, 3);
  const isDataEmpty = participants.length === 0;

  return (
    <div className="flex flex-col min-h-screen relative overflow-x-hidden">
      
      {/* Dynamic Header */}
      <Header
        eventName={config.eventName}
        logoUrl={config.logoUrl}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
        refreshProgress={refreshProgress}
        onOpenSettings={handleOpenSettings}
        onManualRefresh={handleManualRefresh}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        error={error}
      />

      {/* Main Leaderboard Layout */}
      <main className="flex-1 flex flex-col justify-start py-6 w-full z-30">
        {isDataEmpty ? (
          /* Empty/No Sheet Connected Placeholder State */
          <div className="flex-1 max-w-xl mx-auto px-4 py-20 text-center flex flex-col items-center justify-center gap-6">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20 border border-violet-500/20 flex items-center justify-center text-violet-400 animate-pulse-slow">
              <Award className="w-10 h-10" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white uppercase tracking-tight">
                Leaderboard Initializing
              </h2>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                Fetching live standings from the event database. Standings will populate automatically as scores are updated by organizers.
              </p>
            </div>
            {isRefreshing && (
              <div className="flex items-center gap-2 text-violet-400 text-xs font-bold uppercase tracking-wider">
                <span className="w-2 h-2 bg-violet-500 rounded-full animate-ping" /> Loading live data...
              </div>
            )}
          </div>
        ) : (
          /* Live Leaderboard Display */
          <div className="flex flex-col gap-2">
            
            {/* Top 3 Podium */}
            <Podium 
              topThree={topThree} 
              rankChanges={rankChanges} 
            />
            
            {/* Full List Table */}
            <TableList
              participants={participants}
              rankChanges={rankChanges}
              autoScrollEnabled={config.autoScrollEnabled}
              autoScrollSpeed={config.autoScrollSpeed}
            />
            
          </div>
        )}
      </main>



      {/* Animated Alerts and Toast Container */}
      <ToastContainer 
        toasts={toasts} 
        onCloseToast={removeToast} 
      />

    </div>
  );
}
