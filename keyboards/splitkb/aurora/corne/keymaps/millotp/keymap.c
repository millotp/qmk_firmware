/* Copyright 2024 Pierre Millot
 *
 * Interactive Game of Life for Aurora Corne OLED
 * Keypresses inject random life into the simulation!
 */

#include QMK_KEYBOARD_H
#include "logos.h"

#ifdef OLED_ENABLE

enum data_type {
    INVALID,
    STOCK_DATA_TYPE,
    METRO_DATA_TYPE,
    WEATHER_DATA_TYPE,
};

uint32_t last_metro_update = 0;
char     impacted_metro    = '0';
char     message[30]       = {0};

int16_t  temperature = 0;
int16_t  feels_like  = 0;
uint8_t  humidity    = 0;
uint16_t pressure    = 0;
char     sunset[6]   = {0};

void raw_hid_receive(uint8_t *data, uint8_t length) {
    // the received data is shifted by 1, so data[0] is actually the 2nd byte from the sender.
    enum data_type type = data[0];
    switch (type) {
        case INVALID:
            break;
        case STOCK_DATA_TYPE:
            break;
        case METRO_DATA_TYPE:
            last_metro_update = timer_read32();
            impacted_metro    = data[1];
            strcpy(message, (char *)data + 2);
            break;
        case WEATHER_DATA_TYPE:
            temperature = (int16_t)data[1] << 8 | data[2];
            feels_like  = (int16_t)data[3] << 8 | data[4];
            humidity    = data[5];
            pressure    = (uint16_t)data[6] << 8 | data[7];
            strcpy(sunset, (char *)data + 8);
            break;
    }
}

bool oled_task_user(void) {
    // Clear and redraw
    oled_clear();
    // draw the stock price

    char buf[6];
    snprintf(buf, sizeof(buf), "%4d", temperature);
    oled_write(buf, false);

    static const char PROGMEM degree[] = {0x02, 0x05, 0x02, 0x00, 0x3E, 0x41, 0x41, 0x22}; // °C
    oled_write_raw_P(degree, sizeof(degree));
    oled_advance_page(false);

    snprintf(buf, sizeof(buf), "%4d", feels_like);
    oled_write(buf, false);

    oled_write_raw_P(degree, sizeof(degree));
    oled_advance_page(false);

    snprintf(buf, sizeof(buf), "%4d%%", humidity);
    oled_write(buf, false);

    snprintf(buf, sizeof(buf), "%4d", pressure);
    oled_write(buf, false);

    static const char PROGMEM hp[] = {0x7C, 0x10, 0x70, 0x00, 0x7F, 0x09, 0x09, 0x06}; // hP
    oled_write_raw_P(hp, sizeof(hp));
    oled_advance_page(false);

    oled_write("sun  ", false);
    oled_write(sunset, false);

    oled_write_raw_P(datadog_logo, sizeof(datadog_logo));

    return false;
}

// Inject life on keypress for interactivity
bool process_record_user(uint16_t keycode, keyrecord_t *record) {
    if (keycode == KC_A && record->event.pressed) {
        // do something
    }
    return true;
}

#endif // OLED_ENABLE
