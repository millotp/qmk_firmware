/* Copyright 2025 Pierre Millot
 *
 * Weather Display for Aurora Corne OLED
 * Receives weather data via HID and displays it.
 *
 * Display layout (5 chars x 16 lines, rotated 270°):
 * ┌─────┐
 * │ ☀☀☀ │  Lines 0-1: Weather icon (2 rows)
 * │     │  Line 2: Spacer
 * │ 12° │  Line 3: Temperature
 * │  8° │  Line 4: Feels like
 * │ 72% │  Line 5: Humidity
 * │     │  Line 6: Spacer
 * │3.5  │  Line 7: Wind speed
 * │ m/s │  Line 8:
 * │     │  Line 9:
 * │     │  Line 10: Spacer
 * │1013 │  Line 11: Pressure
 * │     │  Line 12:
 * │     │  Line 13: Spacer
 * │07:30│  Line 14: Sunrise time
 * │18:45│  Line 15: Sunset time
 * └─────┘
 */

#include QMK_KEYBOARD_H
#include "logos.h"

#ifdef OLED_ENABLE

// Data types for HID communication
enum data_type {
    INVALID,
    STOCK_DATA_TYPE,
    METRO_DATA_TYPE,
    WEATHER_DATA_TYPE,
};

// Weather condition codes (must match script.ts)
enum weather_condition {
    WEATHER_CLEAR  = 0,
    WEATHER_CLOUDS = 1,
    WEATHER_RAIN   = 2,
    WEATHER_STORM  = 3,
    WEATHER_SNOW   = 4,
    WEATHER_MIST   = 5,
};

// Weather data storage
static struct {
    uint8_t  condition;
    int16_t  temperature; // °C
    int16_t  feels_like;  // °C
    uint8_t  humidity;    // %
    uint16_t pressure;    // hPa
    uint8_t  wind_speed;  // m/s
    char     sunrise[6];  // "HH:MM\0"
    char     sunset[6];   // "HH:MM\0"
    bool     valid;       // data received flag
} weather_data = {0};

// Metro data
uint32_t last_metro_update = 0;
char     impacted_metro    = '0';
char     message[30]       = {0};

void raw_hid_receive(uint8_t *data, uint8_t length) {
    // data[0] is the actual first byte (report ID is stripped)
    enum data_type type = data[0];
    switch (type) {
        case INVALID:
            break;
        case STOCK_DATA_TYPE:
            break;
        case METRO_DATA_TYPE:
            last_metro_update = timer_read32();
            impacted_metro    = data[1];
            strncpy(message, (char *)data + 2, sizeof(message) - 1);
            break;
        case WEATHER_DATA_TYPE:
            weather_data.condition   = data[1];
            weather_data.temperature = (int16_t)data[2] << 8 | data[3];
            weather_data.feels_like  = (int16_t)data[4] << 8 | data[5];
            weather_data.humidity    = data[6];
            weather_data.pressure    = (uint16_t)data[7] << 8 | data[8];
            weather_data.wind_speed  = data[9];
            strncpy(weather_data.sunrise, (char *)data + 10, 5);
            strncpy(weather_data.sunset, (char *)data + 15, 5);
            weather_data.valid = true;
            break;
    }
}

// Weather icons (3 chars wide x 2 rows tall)
// Characters from glcdfont.c: 0x80-0x91 (top) and 0xA0-0xB1 (bottom)
static const char PROGMEM icon_sun[]    = {0x20, 0x80, 0x81, 0x82, 0x20, 0x20, 0xA0, 0xA1, 0xA2, 0x20, 0};
static const char PROGMEM icon_cloudy[] = {0x20, 0x83, 0x84, 0x85, 0x20, 0x20, 0xA3, 0xA4, 0xA5, 0x20, 0};
static const char PROGMEM icon_rain[]   = {0x20, 0x86, 0x87, 0x88, 0x20, 0x20, 0xA6, 0xA7, 0xA8, 0x20, 0};
static const char PROGMEM icon_storm[]  = {0x20, 0x89, 0x8A, 0x8B, 0x20, 0x20, 0xA9, 0xAA, 0xAB, 0x20, 0};
static const char PROGMEM icon_snow[]   = {0x20, 0x8C, 0x8D, 0x8E, 0x20, 0x20, 0xAC, 0xAD, 0xAE, 0x20, 0};
static const char PROGMEM icon_mist[]   = {0x20, 0x8F, 0x90, 0x91, 0x20, 0x20, 0xAF, 0xB0, 0xB1, 0x20, 0};

// raw char
static const char PROGMEM degree[] = {0x02, 0x05, 0x02, 0x00, 0x3E, 0x41, 0x41, 0x22}; // °C
static const char PROGMEM hp[]     = {0x7C, 0x10, 0x70, 0x00, 0x7F, 0x09, 0x09, 0x06}; // hP

// Render weather icon at current cursor position
static void render_weather_icon(uint8_t condition) {
    switch (condition) {
        case WEATHER_CLEAR:
            oled_write_P(icon_sun, false);
            break;
        case WEATHER_CLOUDS:
            oled_write_P(icon_cloudy, false);
            break;
        case WEATHER_RAIN:
            oled_write_P(icon_rain, false);
            break;
        case WEATHER_STORM:
            oled_write_P(icon_storm, false);
            break;
        case WEATHER_SNOW:
            oled_write_P(icon_snow, false);
            break;
        case WEATHER_MIST:
            oled_write_P(icon_mist, false);
            break;
        default:
            oled_write_P(icon_sun, false);
            break;
    }
}

// Render the master (left) display with weather info
static void render_master(void) {
    char buf[6];

    if (!weather_data.valid) {
        // Show placeholder when no data received
        oled_set_cursor(0, 0);
        oled_write("await", false);
        oled_set_cursor(0, 1);
        oled_write(" HID ", false);
        oled_set_cursor(0, 2);
        oled_write(" data", false);
        return;
    }

    // Line 0-1: Weather icon (centered)
    render_weather_icon(weather_data.condition);

    // Line 2: Spacer (empty)
    oled_set_cursor(0, 2);
    oled_advance_page(true);

    // Line 3: Temperature
    snprintf(buf, sizeof(buf), "%3d", weather_data.temperature);
    oled_write(buf, false);
    oled_write_raw_P(degree, sizeof(degree));

    // Line 4: Feels like
    oled_set_cursor(0, 4);
    snprintf(buf, sizeof(buf), "%3d", weather_data.feels_like);
    oled_write(buf, false);
    oled_write_raw_P(degree, sizeof(degree));

    // Line 5: Humidity
    oled_set_cursor(0, 5);
    snprintf(buf, sizeof(buf), "%3d%%", weather_data.humidity);
    oled_write(buf, false);

    // Line 6: Pressure
    oled_set_cursor(0, 6);
    snprintf(buf, sizeof(buf), "%4d", weather_data.pressure);
    oled_write(buf, false);
    oled_write_raw_P(hp, sizeof(hp));

    // Line 7: Spacer
    oled_set_cursor(0, 7);
    oled_advance_page(true);

    // Line 8: Wind speed
    snprintf(buf, sizeof(buf), "%2dm/s", weather_data.wind_speed);
    oled_write(buf, false);

    // Line 9-13: Spacer
    oled_advance_page(true);
    oled_advance_page(true);
    oled_advance_page(true);
    oled_advance_page(true);
    oled_advance_page(true);

    // Line 14: Sunrise time
    oled_set_cursor(0, 14);
    oled_write(weather_data.sunrise, false);

    // Line 15: Sunset time with sun-down indicator
    oled_set_cursor(0, 15);
    oled_write(weather_data.sunset, false);
}

// Render the slave (right) display - decorative aurora art
static void render_slave(void) {
    oled_write_raw_P(datadog_logo, sizeof(datadog_logo));
    oled_set_cursor(0, 4);
    oled_write_raw_P(datadog_logo, sizeof(datadog_logo));
    oled_set_cursor(0, 8);
    oled_write_raw_P(datadog_logo, sizeof(datadog_logo));
    oled_set_cursor(0, 12);
    oled_write_raw_P(datadog_logo, sizeof(datadog_logo));
}

bool oled_task_user(void) {
    // this breaks the automatic oled timeout
    // oled_clear();

    if (is_keyboard_master()) {
        render_master();
    } else {
        render_slave();
    }

    return false;
}

// Handle keypresses (can be used for future interactivity)
bool process_record_user(uint16_t keycode, keyrecord_t *record) {
    return true;
}

#endif // OLED_ENABLE
