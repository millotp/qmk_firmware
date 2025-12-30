/* Copyright 2024 Pierre Millot
 *
 * Interactive Game of Life for Aurora Corne OLED
 * Keypresses inject random life into the simulation!
 */

#include QMK_KEYBOARD_H

#ifdef OLED_ENABLE

float current_stock_price = 0;

void raw_hid_receive(uint8_t *data, uint8_t length) {
    current_stock_price = data[0] / 100.0;
}

bool oled_task_user(void) {    
    // Clear and redraw
    oled_clear();
    // draw the stock price
    
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
