// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoicGFqMDAzIiwiYSI6ImNtd2d3MG9kbDBtOGYyeHExdmhlaWw5ZW0ifQ.JqtkHnGW_GhbGBQx7OEKKA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

const svg = d3.select('#map').select('svg');

const departuresByMinute = Array.from({ length: 1440 }, () => []);
const arrivalsByMinute = Array.from({ length: 1440 }, () => []);
let timeFilter = -1;

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();

  return Array.from({ length: 121 }, (_, offset) =>
    (minute - 60 + offset + 1440) % 1440
  ).flatMap((bucketMinute) => tripsByMinute[bucketMinute]);
}

function computeStationTraffic(stations, selectedTime = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, selectedTime),
    (trips) => trips.length,
    (trip) => trip.start_station_id,
  );
  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, selectedTime),
    (trips) => trips.length,
    (trip) => trip.end_station_id,
  );

  return stations.map((station) => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

const bikeLanePaint = {
  'line-color': 'green',
  'line-width': 3,
  'line-opacity': 0.4,
};

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLanePaint,
  });

  map.addSource('cambridge_bike_lanes', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_bike_lanes',
    paint: bikeLanePaint,
  });

  try {
    const jsonData = await d3.json(
      'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
    );
    const trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);

        departuresByMinute[minutesSinceMidnight(trip.started_at)].push(trip);
        arrivalsByMinute[minutesSinceMidnight(trip.ended_at)].push(trip);
        return trip;
      },
    );

    const stations = computeStationTraffic(jsonData.data.stations);
    console.log('Stations Array:', stations);

    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    const circles = svg
      .selectAll('circle')
      .data(stations, (station) => station.short_name)
      .enter()
      .append('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .each(function (d) {
        d3.select(this)
          .append('title')
          .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
          );
      });

    function updateScatterPlot(selectedTime) {
      const filteredStations = computeStationTraffic(stations, selectedTime);
      radiusScale.range(selectedTime === -1 ? [0, 25] : [3, 50]);

      circles
        .data(filteredStations, (station) => station.short_name)
        .join('circle')
        .attr('r', (station) => radiusScale(station.totalTraffic))
        .select('title')
        .text(
          (station) =>
            `${station.totalTraffic} trips (${station.departures} departures, ${station.arrivals} arrivals)`,
        );
    }

    function updatePositions() {
      circles
        .attr('cx', (station) => getCoords(station).cx)
        .attr('cy', (station) => getCoords(station).cy);
    }

    updatePositions();
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    function updateTimeDisplay() {
      timeFilter = Number(timeSlider.value);

      if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
      }

      updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();
  } catch (error) {
    console.error('Error loading bike data:', error);
  }
});
