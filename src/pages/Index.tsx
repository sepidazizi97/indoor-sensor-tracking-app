import { useEffect, useRef, useState } from "react";

interface SensorRow {
  id: number;
  participant_id: string;
  timestamp: string;

  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  altitude: number | null;
  altitude_accuracy: number | null;
  speed: number | null;
  heading: number | null;

  network_effective_type: string | null;
  network_downlink: number | null;
  network_rtt: number | null;
  network_save_data: boolean | null;

  acceleration_x: number | null;
  acceleration_y: number | null;
  acceleration_z: number | null;
  rotation_alpha: number | null;
  rotation_beta: number | null;
  rotation_gamma: number | null;

  orientation_alpha: number | null;
  orientation_beta: number | null;
  orientation_gamma: number | null;

  battery_level: number | null;
  battery_charging: boolean | null;

  control_point_id: string;
  path_id: string;
  notes: string;
}

type NetworkInfo = {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

const IndoorSensorTracker = () => {
  const [participantId, setParticipantId] = useState("P001");
  const [controlPointId, setControlPointId] = useState("");
  const [pathId, setPathId] = useState("");
  const [notes, setNotes] = useState("");
  const [isTracking, setIsTracking] = useState(false);
  const [rows, setRows] = useState<SensorRow[]>([]);
  const [status, setStatus] = useState("Ready to collect data.");

  const intervalRef = useRef<number | null>(null);
  const rowIdRef = useRef(1);

  const motionRef = useRef({
    acceleration_x: null as number | null,
    acceleration_y: null as number | null,
    acceleration_z: null as number | null,
    rotation_alpha: null as number | null,
    rotation_beta: null as number | null,
    rotation_gamma: null as number | null,
  });

  const orientationRef = useRef({
    orientation_alpha: null as number | null,
    orientation_beta: null as number | null,
    orientation_gamma: null as number | null,
  });

  const batteryRef = useRef({
    battery_level: null as number | null,
    battery_charging: null as boolean | null,
  });

  useEffect(() => {
    const handleMotion = (event: DeviceMotionEvent) => {
      motionRef.current = {
        acceleration_x: event.accelerationIncludingGravity?.x ?? null,
        acceleration_y: event.accelerationIncludingGravity?.y ?? null,
        acceleration_z: event.accelerationIncludingGravity?.z ?? null,
        rotation_alpha: event.rotationRate?.alpha ?? null,
        rotation_beta: event.rotationRate?.beta ?? null,
        rotation_gamma: event.rotationRate?.gamma ?? null,
      };
    };

    const handleOrientation = (event: DeviceOrientationEvent) => {
      orientationRef.current = {
        orientation_alpha: event.alpha ?? null,
        orientation_beta: event.beta ?? null,
        orientation_gamma: event.gamma ?? null,
      };
    };

    window.addEventListener("devicemotion", handleMotion);
    window.addEventListener("deviceorientation", handleOrientation);

    return () => {
      window.removeEventListener("devicemotion", handleMotion);
      window.removeEventListener("deviceorientation", handleOrientation);
    };
  }, []);

  const requestMotionPermission = async () => {
    const motion = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

    const orientation = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

    try {
      if (typeof motion.requestPermission === "function") {
        await motion.requestPermission();
      }

      if (typeof orientation.requestPermission === "function") {
        await orientation.requestPermission();
      }
    } catch {
      setStatus(
        "Motion/orientation permission was not granted, but location tracking can still continue."
      );
    }
  };

  const updateBattery = async () => {
    try {
      const nav = navigator as Navigator & {
        getBattery?: () => Promise<{ level: number; charging: boolean }>;
      };

      if (nav.getBattery) {
        const battery = await nav.getBattery();

        batteryRef.current = {
          battery_level: battery.level,
          battery_charging: battery.charging,
        };
      }
    } catch {
      batteryRef.current = {
        battery_level: null,
        battery_charging: null,
      };
    }
  };

  const getNetworkInfo = () => {
    const nav = navigator as Navigator & {
      connection?: NetworkInfo;
      mozConnection?: NetworkInfo;
      webkitConnection?: NetworkInfo;
    };

    const connection =
      nav.connection || nav.mozConnection || nav.webkitConnection;

    return {
      network_effective_type: connection?.effectiveType ?? null,
      network_downlink: connection?.downlink ?? null,
      network_rtt: connection?.rtt ?? null,
      network_save_data: connection?.saveData ?? null,
    };
  };

  const collectOneObservation = async () => {
    if (!navigator.geolocation) {
      setStatus("Geolocation is not supported by this browser.");
      return;
    }

    await updateBattery();

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const c = position.coords;
        const network = getNetworkInfo();

        const newRow: SensorRow = {
          id: rowIdRef.current++,
          participant_id: participantId,
          timestamp: new Date().toISOString(),

          lat: c.latitude ?? null,
          lon: c.longitude ?? null,
          accuracy_m: c.accuracy ?? null,
          altitude: c.altitude ?? null,
          altitude_accuracy: c.altitudeAccuracy ?? null,
          speed: c.speed ?? null,
          heading: c.heading ?? null,

          ...network,
          ...motionRef.current,
          ...orientationRef.current,
          ...batteryRef.current,

          control_point_id: controlPointId,
          path_id: pathId,
          notes,
        };

        setRows((prev) => [newRow, ...prev]);
        setStatus(`Collected observation #${newRow.id}`);
      },
      (error) => {
        setStatus(`Location error: ${error.message}`);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  const startTracking = async () => {
    await requestMotionPermission();
    await collectOneObservation();

    setIsTracking(true);

    intervalRef.current = window.setInterval(() => {
      collectOneObservation();
    }, 5000);
  };

  const stopTracking = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setIsTracking(false);
    setStatus("Tracking stopped.");
  };

  const clearData = () => {
    setRows([]);
    rowIdRef.current = 1;
    setStatus("Data cleared.");
  };

  const exportCSV = () => {
    if (rows.length === 0) return;

    const orderedRows = [...rows].reverse();
    const headers = Object.keys(orderedRows[0]) as Array<keyof SensorRow>;

    const csv = [
      headers.join(","),
      ...orderedRows.map((row) =>
        headers
          .map((header) => {
            const value = row[header];
            const cleanValue =
              value === null || value === undefined ? "" : String(value);

            return `"${cleanValue.replace(/"/g, '""')}"`;
          })
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `indoor_sensor_tracking_${new Date().toISOString()}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  };

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <section>
          <h1 style={styles.title}>Indoor Sensor Tracking App</h1>
          <p style={styles.subtitle}>
            Collects browser-based location, signal/network, motion,
            orientation, and battery variables every 5 seconds.
          </p>
        </section>

        <section style={styles.card}>
          <div style={styles.formGrid}>
            <div>
              <label style={styles.label}>Participant ID</label>
              <input
                style={styles.input}
                value={participantId}
                onChange={(e) => setParticipantId(e.target.value)}
              />
            </div>

            <div>
              <label style={styles.label}>Path ID</label>
              <input
                style={styles.input}
                placeholder="Path 1"
                value={pathId}
                onChange={(e) => setPathId(e.target.value)}
              />
            </div>

            <div>
              <label style={styles.label}>Control Point ID</label>
              <input
                style={styles.input}
                placeholder="GCP 01"
                value={controlPointId}
                onChange={(e) => setControlPointId(e.target.value)}
              />
            </div>

            <div>
              <label style={styles.label}>Notes</label>
              <input
                style={styles.input}
                placeholder="optional"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.buttonRow}>
            {!isTracking ? (
              <button style={styles.primaryButton} onClick={startTracking}>
                Start Tracking
              </button>
            ) : (
              <button style={styles.dangerButton} onClick={stopTracking}>
                Stop Tracking
              </button>
            )}

            <button style={styles.secondaryButton} onClick={collectOneObservation}>
              Collect One Point
            </button>

            <button
              style={styles.secondaryButton}
              onClick={exportCSV}
              disabled={rows.length === 0}
            >
              Export CSV
            </button>

            <button
              style={styles.secondaryButton}
              onClick={clearData}
              disabled={rows.length === 0}
            >
              Clear Data
            </button>

            <p style={styles.status}>{status}</p>
          </div>
        </section>

        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Latest Observations</h2>

          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ID</th>
                  <th style={styles.th}>Time</th>
                  <th style={styles.th}>Lat</th>
                  <th style={styles.th}>Lon</th>
                  <th style={styles.th}>Accuracy m</th>
                  <th style={styles.th}>Speed</th>
                  <th style={styles.th}>Heading</th>
                  <th style={styles.th}>Network</th>
                  <th style={styles.th}>Downlink</th>
                  <th style={styles.th}>RTT</th>
                  <th style={styles.th}>Accel X/Y/Z</th>
                  <th style={styles.th}>Orient A/B/G</th>
                  <th style={styles.th}>Battery</th>
                </tr>
              </thead>

              <tbody>
                {rows.slice(0, 20).map((row) => (
                  <tr key={row.id}>
                    <td style={styles.td}>{row.id}</td>
                    <td style={styles.td}>{row.timestamp}</td>
                    <td style={styles.td}>{row.lat?.toFixed(6)}</td>
                    <td style={styles.td}>{row.lon?.toFixed(6)}</td>
                    <td style={styles.td}>{row.accuracy_m}</td>
                    <td style={styles.td}>{row.speed}</td>
                    <td style={styles.td}>{row.heading}</td>
                    <td style={styles.td}>
                      {row.network_effective_type ?? "NA"}
                    </td>
                    <td style={styles.td}>{row.network_downlink ?? "NA"}</td>
                    <td style={styles.td}>{row.network_rtt ?? "NA"}</td>
                    <td style={styles.td}>
                      {row.acceleration_x?.toFixed(2) ?? "NA"} /{" "}
                      {row.acceleration_y?.toFixed(2) ?? "NA"} /{" "}
                      {row.acceleration_z?.toFixed(2) ?? "NA"}
                    </td>
                    <td style={styles.td}>
                      {row.orientation_alpha?.toFixed(2) ?? "NA"} /{" "}
                      {row.orientation_beta?.toFixed(2) ?? "NA"} /{" "}
                      {row.orientation_gamma?.toFixed(2) ?? "NA"}
                    </td>
                    <td style={styles.td}>
                      {row.battery_level !== null
                        ? `${Math.round(row.battery_level * 100)}%`
                        : "NA"}
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td style={styles.emptyCell} colSpan={13}>
                      No data collected yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    padding: "24px",
    fontFamily: "Arial, sans-serif",
  },
  container: {
    maxWidth: "1200px",
    margin: "0 auto",
  },
  title: {
    fontSize: "32px",
    fontWeight: 700,
    marginBottom: "8px",
  },
  subtitle: {
    color: "#64748b",
    marginBottom: "24px",
  },
  card: {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    padding: "24px",
    marginBottom: "20px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "16px",
  },
  label: {
    display: "block",
    fontSize: "14px",
    fontWeight: 600,
    marginBottom: "6px",
  },
  input: {
    width: "100%",
    padding: "10px",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "14px",
  },
  buttonRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "12px",
  },
  primaryButton: {
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: "8px",
    padding: "10px 16px",
    cursor: "pointer",
    fontWeight: 600,
  },
  dangerButton: {
    background: "#dc2626",
    color: "white",
    border: "none",
    borderRadius: "8px",
    padding: "10px 16px",
    cursor: "pointer",
    fontWeight: 600,
  },
  secondaryButton: {
    background: "#f1f5f9",
    color: "#0f172a",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    padding: "10px 16px",
    cursor: "pointer",
    fontWeight: 600,
  },
  status: {
    marginLeft: "auto",
    color: "#64748b",
    fontSize: "14px",
  },
  sectionTitle: {
    fontSize: "22px",
    fontWeight: 700,
    marginBottom: "12px",
  },
  tableWrapper: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    minWidth: "1200px",
    borderCollapse: "collapse",
    fontSize: "14px",
  },
  th: {
    textAlign: "left",
    padding: "10px",
    borderBottom: "1px solid #cbd5e1",
    background: "#f1f5f9",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px",
    borderBottom: "1px solid #e2e8f0",
    whiteSpace: "nowrap",
  },
  emptyCell: {
    padding: "20px",
    textAlign: "center",
    color: "#64748b",
  },
};

export default IndoorSensorTracker;
