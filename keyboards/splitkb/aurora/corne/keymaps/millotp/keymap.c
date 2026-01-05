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
#include "raw_hid.h"
#include "transactions.h"

enum my_keycodes {
    SHOW_METRO = SAFE_RANGE,
    PREVIOUS_STOCK,
    NEXT_STOCK,
};

// clang-format off
enum layer_names {
    _DEFAULT,
    _LOWER,
    _RAISE,
    _ADJUST
};

const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {
    [_DEFAULT] = LAYOUT_split_3x6_3(
      KC_TAB,  KC_Q, KC_W, KC_F, KC_P, KC_B,         KC_J, KC_L, KC_U,    KC_Y,   KC_SCLN, KC_BSPC,
      KC_LSFT, KC_A, KC_R, KC_S, KC_T, KC_G,         KC_M, KC_N, KC_E,    KC_I,   KC_O,    KC_QUOT,
      KC_LCTL, KC_Z, KC_X, KC_C, KC_D, KC_V,         KC_K, KC_H, KC_COMM, KC_DOT, KC_SLSH, KC_ESC,

                     KC_LGUI, MO(1), KC_SPC,         KC_ENT, MO(2), KC_RALT
    ),
    [_LOWER] = LAYOUT_split_3x6_3(
      KC_TAB,  KC_1,    KC_2,    KC_3,    KC_4,    KC_5,           KC_6,    KC_7,    KC_8,    KC_9,     KC_0,    KC_DEL,
      KC_LSFT, XXXXXXX, KC_VOLU, KC_MPRV, KC_MNXT, XXXXXXX,        KC_LEFT, KC_DOWN, KC_UP,   KC_RIGHT, XXXXXXX, XXXXXXX,
      KC_LCTL, KC_MPLY, KC_VOLD, XXXXXXX, XXXXXXX, XXXXXXX,        XXXXXXX, XXXXXXX, XXXXXXX, XXXXXXX,  XXXXXXX, XXXXXXX,

                                  KC_LGUI, _______, KC_SPC,        KC_ENT, MO(3), KC_RALT
    ),
    [_RAISE] = LAYOUT_split_3x6_3(
      KC_TAB,  KC_EXLM, KC_AT,   KC_HASH, KC_DLR,         KC_PERC, KC_CIRC, KC_AMPR, KC_ASTR, KC_LPRN, KC_RPRN, KC_DEL,
      KC_LSFT, XXXXXXX, XXXXXXX, XXXXXXX, XXXXXXX,        XXXXXXX, KC_MINS, KC_EQL,  KC_LBRC, KC_RBRC, KC_BSLS, KC_GRV,
      KC_LCTL, XXXXXXX, XXXXXXX, XXXXXXX, XXXXXXX,        XXXXXXX, KC_UNDS, KC_PLUS, KC_LCBR, KC_RCBR, KC_PIPE, KC_TILD,

                           KC_LGUI, MO(3), KC_SPC,        KC_ENT, _______, KC_RALT
    ),
    [_ADJUST] = LAYOUT_split_3x6_3(
      QK_BOOT, XXXXXXX, XXXXXXX, XXXXXXX, XXXXXXX, XXXXXXX,        XXXXXXX,    XXXXXXX,        XXXXXXX,    XXXXXXX, XXXXXXX, XXXXXXX,
      RM_TOGG, RM_HUEU, RM_SATU, RM_VALU, XXXXXXX, XXXXXXX,        SHOW_METRO, PREVIOUS_STOCK, NEXT_STOCK, XXXXXXX, XXXXXXX, XXXXXXX,
      RM_NEXT, RM_HUED, RM_SATD, RM_VALD, XXXXXXX, XXXXXXX,        XXXXXXX,    XXXXXXX,        XXXXXXX,    XXXXXXX, XXXXXXX, XXXXXXX,

                                  KC_LGUI, _______, KC_SPC,        KC_ENT, _______, KC_RALT
    )
};
// clang-format on

#ifdef OLED_ENABLE

// Data types for HID communication
enum data_type {
    INVALID,
    STOCK_DATA_TYPE,
    METRO_DATA_TYPE,
    METRO_MESSAGE_1_DATA_TYPE,
    METRO_MESSAGE_2_DATA_TYPE,
    WEATHER_DATA_TYPE,
};

typedef struct {
    enum stock_symbols index;
    char               symbol[5];
    bool               open;
    uint32_t           current_price;
    int32_t            day_change_percentage; // can be negative
    uint8_t            history_length;
    uint8_t            history[24]; // normalized 0-31 values
} single_stock_data;

single_stock_data  stock_data[NUMBER_OF_STOCKS];
enum stock_symbols selected_stock = DDOG;

// Draw a line between two points using Bresenham's algorithm
static void oled_draw_line(int16_t x0, int16_t y0, int16_t x1, int16_t y1) {
    int16_t dx = abs(x1 - x0);
    int16_t dy = -abs(y1 - y0);
    int16_t sx = x0 < x1 ? 1 : -1;
    int16_t sy = y0 < y1 ? 1 : -1;
    int16_t err = dx + dy;

    while (true) {
        oled_write_pixel(x0, y0, true);

        if (x0 == x1 && y0 == y1) break;

        int16_t e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x0 += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y0 += sy;
        }
    }
}

// Decode history from packed 5-bit format in HID payload
static void decode_stock_history(uint8_t *data, uint8_t history_length, uint8_t *history_out) {
    // History is encoded in the payload, each value is 5 bits, packed sequentially
    uint16_t bit_pos = 0;
    for (uint8_t i = 0; i < history_length && i < 24; i++) {
        uint8_t value = 0;
        for (uint8_t b = 0; b < 5; b++, bit_pos++) {
            uint8_t byte_idx = bit_pos >> 3;
            uint8_t bit_idx = bit_pos & 7;
            if (data[byte_idx] & (1 << bit_idx)) {
                value |= (1 << b);
            }
        }
        history_out[i] = value;
    }
}

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

static struct {
    uint32_t last_update;
    char     impacted_line;
    char     message[29 * 3 + 1];
} metro_data = {0};

bool show_metro_message = false;

void raw_hid_receive(uint8_t *data, uint8_t length) {
    // data[0] is the actual first byte (report ID is stripped)
    enum data_type type = data[0];
    switch (type) {
        case INVALID:
            break;
        case STOCK_DATA_TYPE: {
            uint8_t index           = data[1];
            stock_data[index].index = index;
            strncpy(stock_data[index].symbol, index == 0 ? "DDOG" : "AAPL", 5);
            stock_data[index].open                  = data[2];
            stock_data[index].current_price         = (uint32_t)data[3] << 24 | (uint32_t)data[4] << 16 | (uint32_t)data[5] << 8 | data[6];
            stock_data[index].day_change_percentage = (int32_t)((uint32_t)data[7] << 24 | (uint32_t)data[8] << 16 | (uint32_t)data[9] << 8 | data[10]);
            stock_data[index].history_length        = data[11];
            // Decode the packed 5-bit history values
            decode_stock_history(data + 12, stock_data[index].history_length, stock_data[index].history);
            break;
        }
        case METRO_DATA_TYPE:
            metro_data.last_update   = timer_read32();
            metro_data.impacted_line = data[1];
            strncpy(metro_data.message, (char *)data + 2, 29);
            break;
        case METRO_MESSAGE_1_DATA_TYPE:
            strncpy(metro_data.message + 29, (char *)data + 2, 29);
            break;
        case METRO_MESSAGE_2_DATA_TYPE:
            strncpy(metro_data.message + 29 * 2, (char *)data + 2, 29);
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

    if (is_keyboard_master()) {
        // forward the data to the slave
        transaction_rpc_send(HID_DATA_IN, length, data);
    }
}

bool metro_has_incident(void) {
    return timer_read32() - metro_data.last_update < 10 * 60 * 1000;
}

// Weather icons (3 chars wide x 2 rows tall)
// Characters from glcdfont.c: 0x80-0x91 (top) and 0xA0-0xB1 (bottom)
static const char PROGMEM icon_sun[]    = {0x20, 0x80, 0x81, 0x82, 0x20, 0x20, 0xA0, 0xA1, 0xA2, 0x20, 0};
static const char PROGMEM icon_cloudy[] = {0x20, 0x83, 0x84, 0x85, 0x20, 0x20, 0xA3, 0xA4, 0xA5, 0x20, 0};
static const char PROGMEM icon_rainy[]  = {0x20, 0x86, 0x87, 0x88, 0x20, 0x20, 0xA6, 0xA7, 0xA8, 0x20, 0};
static const char PROGMEM icon_storm[]  = {0x20, 0x89, 0x8A, 0x8B, 0x20, 0x20, 0xA9, 0xAA, 0xAB, 0x20, 0};
static const char PROGMEM icon_snow[]   = {0x20, 0x8C, 0x8D, 0x8E, 0x20, 0x20, 0xAC, 0xAD, 0xAE, 0x20, 0};
static const char PROGMEM icon_mist[]   = {0x20, 0x8F, 0x90, 0x91, 0x20, 0x20, 0xAF, 0xB0, 0xB1, 0x20, 0};
static const char PROGMEM icon_line_6[] = {0x20, 0x92, 0x93, 0x94, 0x20, 0x20, 0xB2, 0xB3, 0xB4, 0x20, 0};
static const char PROGMEM icon_line_8[] = {0x20, 0x95, 0x96, 0x97, 0x20, 0x20, 0xB5, 0xB6, 0xB7, 0x20, 0};
static const char PROGMEM icon_line_9[] = {0x20, 0x98, 0x99, 0x9A, 0x20, 0x20, 0xB8, 0xB9, 0xBA, 0x20, 0};

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
            oled_write_P(icon_rainy, false);
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

// Render metro line icon at current cursor position
static void render_metro_line_icon(char line) {
    switch (line) {
        case '6':
            oled_write_P(icon_line_6, false);
            break;
        case '8':
            oled_write_P(icon_line_8, false);
            break;
        case '9':
            oled_write_P(icon_line_9, false);
            break;
    }
}

// Draw the stock price graph
// Graph area: x=0-31, y=48-127 (lines 6-15, 80 pixels tall)
static void render_stock_graph(single_stock_data *stock) {
    if (stock->history_length < 2) return;

    // Graph dimensions
    const uint8_t graph_y_start = 48;  // Start at line 6 (6 * 8 = 48)
    const uint8_t graph_height = 72;   // 9 lines worth of pixels
    const uint8_t graph_width = 30;    // Leave 1px margin on each side

    // Find min/max for scaling (values are already 0-31)
    uint8_t min_val = 31, max_val = 0;
    for (uint8_t i = 0; i < stock->history_length; i++) {
        if (stock->history[i] < min_val) min_val = stock->history[i];
        if (stock->history[i] > max_val) max_val = stock->history[i];
    }

    // Avoid division by zero
    uint8_t range = max_val - min_val;
    if (range == 0) range = 1;

    // Calculate x spacing between points
    uint8_t x_step = graph_width / (stock->history_length - 1);
    if (x_step == 0) x_step = 1;

    // Draw the graph line connecting points
    int16_t prev_x = 1;
    int16_t prev_y = graph_y_start + graph_height - 1 -
                     ((stock->history[0] - min_val) * (graph_height - 1) / range);

    for (uint8_t i = 1; i < stock->history_length; i++) {
        int16_t x = 1 + (i * graph_width) / (stock->history_length - 1);
        int16_t y = graph_y_start + graph_height - 1 -
                    ((stock->history[i] - min_val) * (graph_height - 1) / range);

        oled_draw_line(prev_x, prev_y, x, y);

        prev_x = x;
        prev_y = y;
    }
}

// Render the master (left) display with stock info
static void render_master(void) {
    char buf[10];
    single_stock_data *stock = &stock_data[selected_stock];

    // Lines 0-2: Logo (24 pixels, 3 pages)
    oled_write_raw_P(stocks_logo[stock->index], sizeof(stocks_logo[stock->index]));

    // Line 3: Symbol
    oled_set_cursor(0, 3);
    oled_write_ln(stock->symbol, false);

    // Line 4: Current price (format: $XXX.XX)
    uint32_t dollars = stock->current_price / 100;
    uint32_t cents = stock->current_price % 100;
    snprintf(buf, sizeof(buf), "%3lu.%02lu", (unsigned long)dollars, (unsigned long)cents);
    oled_write_ln(buf, false);

    if (stock->open) {
        // Line 5: Day change percentage
        int32_t change = stock->day_change_percentage;
        char sign = change >= 0 ? '+' : '-';
        if (change < 0) change = -change;
        uint32_t change_int = change / 100;
        uint32_t change_dec = change % 100;
        snprintf(buf, sizeof(buf), "%c%lu.%02lu%%", sign, (unsigned long)change_int, (unsigned long)change_dec);
        oled_write_ln(buf, false);

        // Lines 6-15: Stock price graph
        render_stock_graph(stock);
    } else {
        // Market closed
        oled_write_ln("CLOSD", false);
    }
}

// Render the slave (rigth) display with weather/metro info
static void render_slave(void) {
    char buf[6];

    if (!weather_data.valid) {
        // Show placeholder when no data received
        oled_set_cursor(0, 0);
        oled_write("await", false);
        oled_write_ln("HID", false);
        oled_write("data", false);
        return;
    }

    if (show_metro_message && metro_has_incident()) {
        oled_write(metro_data.message, false);
        return;
    }

    // Line 0-1: Weather icon (centered)
    render_weather_icon(weather_data.condition);

    // Line 2: Spacer (empty)
    oled_set_cursor(0, 2);
    oled_advance_page(true);

    // Line 3: Temperature
    snprintf(buf, sizeof(buf), "%3d  ", weather_data.temperature);
    oled_write(buf, false);
    oled_set_cursor(3, 3);
    oled_write_raw_P(degree, sizeof(degree));

    // Line 4: Feels like
    oled_set_cursor(0, 4);
    snprintf(buf, sizeof(buf), "%3d  ", weather_data.feels_like);
    oled_write(buf, false);
    oled_set_cursor(3, 4);
    oled_write_raw_P(degree, sizeof(degree));

    // Line 5: Humidity
    oled_set_cursor(0, 5);
    snprintf(buf, sizeof(buf), "%3d%%", weather_data.humidity);
    oled_write_ln(buf, false);

    // Line 6: Pressure
    snprintf(buf, sizeof(buf), "%4d", weather_data.pressure);
    oled_write(buf, false);
    oled_write_raw_P(hp, sizeof(hp));

    // Line 7: Spacer
    oled_set_cursor(0, 7);
    oled_advance_page(true);

    // Line 8: Wind speed
    snprintf(buf, sizeof(buf), "%2dm/s", weather_data.wind_speed);
    oled_write(buf, false);
    oled_advance_page(true);

    if (metro_has_incident() && (timer_read32() / 2000) % 4 < 3) {
        // blink the icon on line 10-11
        render_metro_line_icon(metro_data.impacted_line);
        oled_set_cursor(0, 12);
    } else {
        oled_advance_page(true);
        oled_advance_page(true);
    }

    // Line 12-13: Spacer
    oled_advance_page(true);
    oled_advance_page(true);

    // Line 14: Sunrise time
    oled_write(weather_data.sunrise, false);

    // Line 15: Sunset time with sun-down indicator
    oled_write(weather_data.sunset, false);
}

// Render the slave (right) display - decorative aurora art

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

uint32_t last_heartbeat = 0;

// Handle keypresses (can be used for future interactivity)
bool process_record_user(uint16_t keycode, keyrecord_t *record) {
    if (timer_read32() - last_heartbeat > 5 * 60 * 1000) {
        last_heartbeat = timer_read32();

        // send a heartbeat to the host
        uint8_t buf[32] = {0};
        buf[1]          = 1;
        raw_hid_send(buf, 32);
    }

    show_metro_message = record->event.pressed && keycode == SHOW_METRO;

    if (record->event.pressed) {
        switch (keycode) {
            case PREVIOUS_STOCK:
                selected_stock = (selected_stock + NUMBER_OF_STOCKS - 1) % NUMBER_OF_STOCKS;
                break;
            case NEXT_STOCK:
                selected_stock = (selected_stock + 1) % NUMBER_OF_STOCKS;
                break;
        }
    }

    return true;
}

// Handle communication with the slave
void user_hid_data_in_slave_handler(uint8_t in_buflen, const void *in_data, uint8_t out_buflen, void *out_data) {
    raw_hid_receive((uint8_t *)in_data, in_buflen);
}

void keyboard_post_init_user(void) {
    transaction_register_rpc(HID_DATA_IN, user_hid_data_in_slave_handler);
}

#endif // OLED_ENABLE
