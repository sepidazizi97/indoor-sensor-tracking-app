import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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
      setStatus("Motion/orientation permission was not granted, but location tracking can still continue.");
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
      batteryRef.current = { battery_level: null, battery_charging: null };
    }
  };

  const getNetworkInfo = () => {
    const nav = navigator as Navigator & {
      connection?: NetworkInfo;
      mozConnection?: NetworkInfo;
      webkitConnection?: NetworkInfo;
    };

    const connection = nav.connection || nav.mozConnection || nav.webkitConnection;

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
            const cleanValue = value === null || value === undefined ? "" : String(value);
            return `"${cleanValue.replace(/"/g, '""')}"`;
          })
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `indoor_sensor_tracking_${new Date().toISOString()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Indoor Sensor Tracking App</h1>
          <p className="mt-2 text-muted-foreground">
            Collects browser-based location, signal/network, motion, orientation, and battery variables every 5 seconds.
          </p>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="grid gap-4 p-6 md:grid-cols-4">
            <div>
              <label className="text-sm font-medium">Participant ID</label>
              <input
                className="mt-1 w-full rounded-md border p-2"
                value={participantId}
                onChange={(e) => setParticipantId(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Path ID</label>
              <input
                className="mt-1 w-full rounded-md border p-2"
                placeholder="Path 1"
                value={pathId}
                onChange={(e) => setPathId(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Control Point ID</label>
              <input
                className="mt-1 w-full rounded-md border p-2"
                placeholder="GCP 01"
                value={controlPointId}
                onChange={(e) => setControlPointId(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Notes</label>
              <input
                className="mt-1 w-full rounded-md border p-2"
                placeholder="optional"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="flex flex-wrap items-center gap-3 p-6">
            {!isTracking ? (
              <Button onClick={startTracking}>Start Tracking</Button>
            ) : (
              <Button variant="destructive" onClick={stopTracking}>Stop Tracking</Button>
            )}
            <Button variant="secondary" onClick={collectOneObservation}>Collect One Point</Button>
            <Button variant="outline" onClick={exportCSV} disabled={rows.length === 0}>Export CSV</Button>
            <Button variant="outline" onClick={clearData} disabled={rows.length === 0}>Clear Data</Button>
            <p className="ml-auto text-sm text-muted-foreground">{status}</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6">
            <h2 className="mb-3 text-xl font-semibold">Latest Observations</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-slate-100 text-left">
                    <th className="p-2">ID</th>
                    <th className="p-2">Time</th>
                    <th className="p-2">Lat</th>
                    <th className="p-2">Lon</th>
                    <th className="p-2">Accuracy m</th>
                    <th className="p-2">Speed</th>
                    <th className="p-2">Heading</th>
                    <th className="p-2">Network</th>
                    <th className="p-2">Downlink</th>
                    <th className="p-2">RTT</th>
                    <th className="p-2">Accel X/Y/Z</th>
                    <th className="p-2">Orient A/B/G</th>
                    <th className="p-2">Battery</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((row) => (
                    <tr key={row.id} className="border-b">
                      <td className="p-2">{row.id}</td>
                      <td className="p-2">{row.timestamp}</td>
                      <td className="p-2">{row.lat?.toFixed(6)}</td>
                      <td className="p-2">{row.lon?.toFixed(6)}</td>
                      <td className="p-2">{row.accuracy_m}</td>
                      <td className="p-2">{row.speed}</td>
                      <td className="p-2">{row.heading}</td>
                      <td className="p-2">{row.network_effective_type ?? "NA"}</td>
                      <td className="p-2">{row.network_downlink ?? "NA"}</td>
                      <td className="p-2">{row.network_rtt ?? "NA"}</td>
                      <td className="p-2">
                        {row.acceleration_x?.toFixed(2) ?? "NA"} / {row.acceleration_y?.toFixed(2) ?? "NA"} / {row.acceleration_z?.toFixed(2) ?? "NA"}
                      </td>
                      <td className="p-2">
                        {row.orientation_alpha?.toFixed(2) ?? "NA"} / {row.orientation_beta?.toFixed(2) ?? "NA"} / {row.orientation_gamma?.toFixed(2) ?? "NA"}
                      </td>
                      <td className="p-2">
                        {row.battery_level !== null ? `${Math.round(row.battery_level * 100)}%` : "NA"}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={13} className="p-4 text-center text-muted-foreground">
                        No data collected yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default IndoorSensorTracker;
