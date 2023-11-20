/**
 * This file contains the class AutomationsExtension and its definitions.
 *
 * @file automations.ts
 * @author Luligu
 * @date 2023-10-15
 *
 * All rights reserved.
 *
 */

//
// [@ts-ignore is because the packages are defined inside zigbee2mqtt and so not available here]
//

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore
import yaml from '../util/yaml';
// @ts-ignore
import data from '../util/data';
// @ts-ignore
import { Buffer } from 'buffer';

import type Zigbee from 'zigbee2mqtt/dist/zigbee';
import type MQTT from 'zigbee2mqtt/dist/mqtt';
import type State from 'zigbee2mqtt/dist/state';
import type EventBus from 'zigbee2mqtt/dist/eventBus';
import type Settings from 'zigbee2mqtt/dist/util/settings';
import type Logger from 'zigbee2mqtt/dist/util/logger';

function toArray<T>(item: T | T[]): T[] {
  return Array.isArray(item) ? item : [item];
}

enum ConfigSunCalc {
  SOLAR_NOON = 'solarNoon',
  NADIR = 'nadir',
  SUNRISE = 'sunrise',
  SUNSET = 'sunset',
  SUNRISE_END = 'sunriseEnd',
  SUNSET_START = 'sunsetStart',
  DAWN = 'dawn',
  DUSK = 'dusk',
  NAUTICAL_DAWN = 'nauticalDawn',
  NAUTICAL_DUSK = 'nauticalDusk',
  NIGHT_END = 'nightEnd',
  NIGHT = 'night',
  GOLDEN_HOUR_END = 'goldenHourEnd',
  GOLDEN_HOUR = 'goldenHour',
}

enum ConfigState {
  ON = 'ON',
  OFF = 'OFF',
  TOGGLE = 'TOGGLE',
}

enum ConfigPayload {
  TOGGLE = 'toggle',
  TURN_ON = 'turn_on',
  TURN_OFF = 'turn_off',
}

type ConfigStateType = string;
type ConfigPayloadType = string | number | boolean;
type ConfigActionType = string;
type ConfigAttributeType = string;
type ConfigAttributeValueType = string | number | boolean;

type StateChangeType = string | number | boolean;
type StateChangeUpdate = Record<string, StateChangeType>;
type StateChangeFrom = Record<string, StateChangeType>;
type StateChangeTo = Record<string, StateChangeType>;

type TriggerForType = number;
type TurnOffAfterType = number;
type ExecuteOnceType = boolean;
type ActiveType = boolean;
type TimeStringType = string; // e.g. "15:05:00"
type LoggerType = string;

interface ConfigTrigger {
  entity: EntityId | EntityId[];
  time: TimeStringType;
}

interface ConfigTimeTrigger extends ConfigTrigger {
  time: TimeStringType;
  latitude?: number;
  longitude?: number;
  elevation?: number;
}

interface ConfigEventTrigger extends ConfigTrigger {
  entity: EntityId | EntityId[];
  for?: TriggerForType;
  action?: ConfigActionType | ConfigActionType[];
  state?: ConfigStateType | ConfigStateType[];
  attribute?: ConfigAttributeType;
  equal?: ConfigAttributeValueType;
  not_equal?: ConfigAttributeValueType;
  above?: number;
  below?: number;
}

interface ConfigActionTrigger extends ConfigEventTrigger {
  action: ConfigActionType | ConfigActionType[];
}

interface ConfigStateTrigger extends ConfigEventTrigger {
  state: ConfigStateType | ConfigStateType[];
}

interface ConfigAttributeTrigger extends ConfigEventTrigger {
  attribute: ConfigAttributeType;
  equal?: ConfigAttributeValueType;
  not_equal?: ConfigAttributeValueType;
  above?: number;
  below?: number;
}

type ConfigActionPayload = Record<ConfigAttributeType, ConfigPayloadType>;

interface ConfigAction {
  entity: EntityId;
  payload: ConfigActionPayload;
  turn_off_after?: TurnOffAfterType;
  logger?: LoggerType;
}

interface ConfigCondition {
}

interface ConfigEntityCondition extends ConfigCondition {
  entity: EntityId;
  state?: ConfigStateType;
  attribute?: ConfigAttributeType;
  equal?: ConfigAttributeValueType;
  not_equal?: ConfigAttributeValueType;
  above?: number;
  below?: number;
}

interface ConfigTimeCondition extends ConfigCondition {
  after?: TimeStringType;
  before?: TimeStringType;
  weekday?: string[];
}

// Yaml defined automations
type ConfigAutomations = {
  [key: string]: {
    execute_once?: ExecuteOnceType;
    active?: ActiveType,
    trigger: ConfigTrigger | ConfigTrigger[],
    action: ConfigAction | ConfigAction[],
    condition?: ConfigCondition | ConfigCondition[],
  }
};

// Internal event based automations
type EventAutomation = {
  name: string,
  execute_once?: ExecuteOnceType;
  trigger: ConfigEventTrigger,
  condition: ConfigCondition[],
  action: ConfigAction[],
};

type EntityId = string;

type EventAutomations = {
  [key: EntityId]: EventAutomation[],
};

// Internal time based automations
type TimeAutomation = {
  name: string,
  execute_once?: ExecuteOnceType;
  trigger: ConfigTimeTrigger,
  condition: ConfigCondition[],
  action: ConfigAction[],
};

type TimeId = string;

type TimeAutomations = {
  [key: TimeId]: TimeAutomation[],
};

class InternalLogger {
  constructor() { }

  debug(message: string, ...args: unknown[]): void {
    console.log(`\x1b[46m\x1b[97m[Automations]\x1b[0m \x1b[38;5;247m${message}\x1b[0m`, ...args);
  }

  warning(message: string, ...args: unknown[]): void {
    console.log(`\x1b[46m\x1b[97m[Automations]\x1b[0m \x1b[38;5;220m${message}\x1b[0m`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    console.log(`\x1b[46m\x1b[97m[Automations]\x1b[0m \x1b[38;5;255m${message}\x1b[0m`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.log(`\x1b[46m\x1b[97m[Automations]\x1b[0m \x1b[38;5;9m${message}\x1b[0m`, ...args);
  }
}

class AutomationsExtension {
  private readonly mqttBaseTopic: string;
  private readonly eventAutomations: EventAutomations = {};
  private readonly timeAutomations: TimeAutomations = {};
  private readonly triggerForTimeouts: Record<string, NodeJS.Timeout>;
  private readonly turnOffAfterTimeouts: Record<string, NodeJS.Timeout>;
  private midnightTimeout: NodeJS.Timeout;
  private readonly log: InternalLogger;

  constructor(
    protected zigbee: Zigbee,
    protected mqtt: MQTT,
    protected state: State,
    protected publishEntityState: unknown,
    protected eventBus: EventBus,
    protected settings: typeof Settings,
    protected logger: typeof Logger,
  ) {
    this.log = new InternalLogger();
    this.mqttBaseTopic = settings.get().mqtt.base_topic;
    this.triggerForTimeouts = {};
    this.turnOffAfterTimeouts = {};

    this.parseConfig(settings.get().automations || {});

    this.logger.info(`[Automations] Extension loaded`);

    /*
    this.log.info(`Event automation:`);
    Object.keys(this.eventAutomations).forEach(key => {
      const eventAutomationArray = this.eventAutomations[key];
      eventAutomationArray.forEach(eventAutomation => {
        this.log.info(`- key: #${key}# automation: ${this.stringify(eventAutomation, true)}`);
      });
    });
    */
    //this.log.info(`Time automation:`);
    Object.keys(this.timeAutomations).forEach(key => {
      const timeAutomationArray = this.timeAutomations[key];
      timeAutomationArray.forEach(timeAutomation => {
        //this.log.info(`- key: #${key}# automation: ${this.stringify(timeAutomation, true)}`);
        this.startTimeTriggers(key, timeAutomation);
      });
    });

    this.startMidnightTimeout();
  }

  private parseConfig(configAutomations: ConfigAutomations | string) {
    if (typeof configAutomations === 'string') {
      configAutomations = (yaml.readIfExists(data.joinPath(configAutomations)) || {}) as ConfigAutomations;
    }

    Object.entries(configAutomations).forEach(([key, configAutomation]) => {
      const actions = toArray(configAutomation.action);
      const conditions = configAutomation.condition ? toArray(configAutomation.condition) : [];
      const triggers = toArray(configAutomation.trigger);

      // Check automation
      if (configAutomation.active === false) {
        this.logger.info(`[Automations] Automation [${key}] not registered since active is false`);
        return;
      }
      if (!configAutomation.trigger) {
        this.logger.error(`[Automations] Config validation error for [${key}]: no triggers defined`);
        return;
      }
      if (!configAutomation.action) {
        this.logger.error(`[Automations] Config validation error for [${key}]: no actions defined`);
        return;
      }
      // Check triggers
      for (const trigger of triggers) {
        if (!trigger.time && !trigger.entity) {
          this.logger.error(`[Automations] Config validation error for [${key}]: trigger entity not defined`);
          return;
        }
        if (!trigger.time && !this.zigbee.resolveEntity(trigger.entity)) {
          this.logger.error(`[Automations] Config validation error for [${key}]: trigger entity #${trigger.entity}# not found`);
          return;
        }
      }
      // Check actions
      for (const action of actions) {
        if (!action.entity) {
          this.logger.error(`[Automations] Config validation error for [${key}]: action entity not defined`);
          return;
        }
        if (!this.zigbee.resolveEntity(action.entity)) {
          this.logger.error(`[Automations] Config validation error for [${key}]: action entity #${action.entity}# not found`);
          return;
        }
        if (!action.payload) {
          this.logger.error(`[Automations] Config validation error for [${key}]: action payload not defined`);
          return;
        }
      }
      // Check conditions
      for (const condition of conditions) {
        if (!(condition as ConfigEntityCondition).entity && !(condition as ConfigTimeCondition).after && !(condition as ConfigTimeCondition).before && !(condition as ConfigTimeCondition).weekday) {
          this.logger.error(`[Automations] Config validation error for [${key}]: condition unknown`);
          return;
        }
        if ((condition as ConfigEntityCondition).entity && !this.zigbee.resolveEntity((condition as ConfigEntityCondition).entity)) {
          this.logger.error(`[Automations] Config validation error for [${key}]: condition entity #${(condition as ConfigEntityCondition).entity}# not found`);
          return;
        }
      }

      for (const trigger of triggers) {
        if (trigger.time !== undefined) {
          const timeTrigger = trigger as ConfigTimeTrigger;
          this.logger.info(`[Automations] Registering time automation [${key}] trigger: ${timeTrigger.time}`);
          const suncalcs = Object.values(ConfigSunCalc);
          if (suncalcs.includes(timeTrigger.time as ConfigSunCalc)) {
            if (!timeTrigger.latitude || !timeTrigger.longitude) {
              this.logger.error(`[Automations] Config validation error for [${key}]: latitude and longitude are mandatory for ${trigger.time}`);
              return;
            }
            const suncalc = new SunCalc();
            const times = suncalc.getTimes(new Date(), timeTrigger.latitude, timeTrigger.longitude, timeTrigger.elevation ? timeTrigger.elevation : 0) as object;
            this.logger.debug(`[Automations] Sunrise at ${times[ConfigSunCalc.SUNRISE].toLocaleTimeString()} sunset at ${times[ConfigSunCalc.SUNSET].toLocaleTimeString()} for latitude:${timeTrigger.latitude} longitude:${timeTrigger.longitude} elevation:${timeTrigger.elevation ? timeTrigger.elevation : 0}`);
            this.log.debug(`[Automations] For latitude:${timeTrigger.latitude} longitude:${timeTrigger.longitude} elevation:${timeTrigger.elevation ? timeTrigger.elevation : 0} suncalc are:\n`, times);
            const time = times[trigger.time].toLocaleTimeString();
            if (!this.timeAutomations[time])
              this.timeAutomations[time] = [];
            this.timeAutomations[time].push({ name: key, execute_once: configAutomation.execute_once, trigger: timeTrigger, action: actions, condition: conditions });
          } else if (this.matchTimeString(timeTrigger.time)) {
            if (!this.timeAutomations[timeTrigger.time])
              this.timeAutomations[timeTrigger.time] = [];
            this.timeAutomations[timeTrigger.time].push({ name: key, execute_once: configAutomation.execute_once, trigger: timeTrigger, action: actions, condition: conditions });
          } else {
            this.logger.error(`[Automations] Config validation error for [${key}]: time syntax error for ${trigger.time}`);
            return;
          }
        }
        if (trigger.entity !== undefined) {
          const eventTrigger = trigger as ConfigEventTrigger;
          if (!this.zigbee.resolveEntity(eventTrigger.entity)) {
            this.logger.error(`[Automations] Config validation error for [${key}]: trigger entity #${eventTrigger.entity}# not found`);
            return;
          }
          this.logger.info(`[Automations] Registering event automation [${key}] trigger: entity #${eventTrigger.entity}#`);
          const entities = toArray(eventTrigger.entity);
          for (const entity of entities) {
            if (!this.eventAutomations[entity]) {
              this.eventAutomations[entity] = [];
            }
            this.eventAutomations[entity].push({ name: key, execute_once: configAutomation.execute_once, trigger: eventTrigger, action: actions, condition: conditions });
          }
        }
      } // for (const trigger of triggers)
    });
  }

  /**
   * Check a time string and return a Date or undefined if error
   */
  private matchTimeString(timeString: TimeStringType): Date | undefined {
    if (timeString.length !== 8)
      return undefined;
    const match = timeString.match(/(\d{2}):(\d{2}):(\d{2})/);
    if (match && parseInt(match[1], 10) <= 23 && parseInt(match[2], 10) <= 59 && parseInt(match[3], 10) <= 59) {
      const time = new Date();
      time.setHours(parseInt(match[1], 10));
      time.setMinutes(parseInt(match[2], 10));
      time.setSeconds(parseInt(match[3], 10));
      return time;
    }
    return undefined;
  }

  /**
   * Start a timeout in the first second of tomorrow date.
   * The timeout callback then will start the time triggers for tomorrow and start again a timeout for the next day.
   */
  private startMidnightTimeout(): void {
    const now = new Date();
    const timeEvent = new Date();
    timeEvent.setHours(23);
    timeEvent.setMinutes(59);
    timeEvent.setSeconds(59);
    this.logger.debug(`[Automations] Set timeout to reload for time automations`);
    this.midnightTimeout = setTimeout(() => {
      this.logger.info(`[Automations] Run timeout to reload time automations`);
      Object.keys(this.timeAutomations).forEach(key => {
        const timeAutomationArray = this.timeAutomations[key];
        timeAutomationArray.forEach(timeAutomation => {
          this.startTimeTriggers(key, timeAutomation);
        });
      });
      this.startMidnightTimeout();
    }, timeEvent.getTime() - now.getTime() + 2000);
    this.midnightTimeout.unref();
  }

  /**
   * Take the key of TimeAutomations that is a string like hh:mm:ss, convert it in a Date object of today
   * and set the timer if not already passed for today.
   * The timeout callback then will run the automations
   */
  private startTimeTriggers(key: TimeId, automation: TimeAutomation): void {
    const now = new Date();

    const timeEvent = this.matchTimeString(key);
    if (timeEvent !== undefined) {
      if (timeEvent.getTime() > now.getTime()) {
        this.logger.debug(`[Automations] Set timout at ${timeEvent.toLocaleString()} for [${automation.name}]`);
        const timeout = setTimeout(() => {
          delete this.triggerForTimeouts[automation.name];
          this.logger.debug(`[Automations] Timout for [${automation.name}]`);
          this.runActionsWithConditions(automation, automation.condition, automation.action);
        }, timeEvent.getTime() - now.getTime());
        timeout.unref();
        this.triggerForTimeouts[automation.name] = timeout;
      }
      else {
        this.logger.debug(`[Automations] Timout at ${timeEvent.toLocaleString()} is passed for [${automation.name}]`);
      }
    } else {
      this.logger.error(`[Automations] Timout config error at ${key} for [${automation.name}]`);
    }
  }

  /**
   * null - return
   * false - return and stop timer
   * true - start the automation
   */
  private checkTrigger(automation: EventAutomation, configTrigger: ConfigEventTrigger, update: StateChangeUpdate, from: StateChangeFrom, to: StateChangeTo): boolean | null {
    let trigger;
    let attribute;
    let result;
    let actions;

    //this.log.warning(`[Automations] Trigger check [${automation.name}] update: ${this.stringify(update)} from: ${this.stringify(from)} to: ${this.stringify(to)}`);

    if (configTrigger.action !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(update, 'action')) {
        this.logger.debug(`[Automations] Trigger check [${automation.name}] no 'action' in update for #${configTrigger.entity}#`);
        return null;
      }
      trigger = configTrigger as ConfigActionTrigger;
      actions = toArray(trigger.action);
      result = actions.includes(update.action as ConfigActionType);
      this.logger.debug(`[Automations] Trigger check [${automation.name}] trigger is ${result} for #${configTrigger.entity}# action(s): ${this.stringify(actions)}`);
      return result;
    } else if (configTrigger.attribute !== undefined) {
      trigger = configTrigger as ConfigAttributeTrigger;
      attribute = trigger.attribute;
      if (!Object.prototype.hasOwnProperty.call(update, attribute) || !Object.prototype.hasOwnProperty.call(to, attribute)) {
        this.logger.debug(`[Automations] Trigger check [${automation.name}] no '${attribute}' published for #${configTrigger.entity}#`);
        return null;
      }
      if (from[attribute] === to[attribute]) {
        this.logger.debug(`[Automations] Trigger check [${automation.name}] no '${attribute}' change for #${configTrigger.entity}#`);
        return null;
      }

      if (typeof trigger.equal !== 'undefined' || typeof trigger.state !== 'undefined') {
        const value = trigger.state !== undefined ? trigger.state : trigger.equal;
        if (to[attribute] !== value) {
          this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' != ${value} for #${configTrigger.entity}#`);
          return false;
        }
        if (from[attribute] === value) {
          this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' already = ${value} for #${configTrigger.entity}#`);
          return null;
        }
        this.logger.debug(`[Automations] Trigger check [${automation.name}] trigger equal/state ${value} is true for #${configTrigger.entity}# ${attribute} is ${to[attribute]} `);
      }

      if (typeof trigger.not_equal !== 'undefined') {
        if (to[attribute] === trigger.not_equal) {
          this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' = ${trigger.not_equal} for #${configTrigger.entity}#`);
          return false;
        }
        if (from[attribute] !== trigger.not_equal) {
          this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' already != ${trigger.not_equal} for #${configTrigger.entity}#`);
          return null;
        }
        this.logger.debug(`[Automations] Trigger check [${automation.name}] trigger not equal ${trigger.not_equal} is true for #${configTrigger.entity}# ${attribute} is ${to[attribute]} `);
      }

      if (typeof trigger.above !== 'undefined') {
        if (to[attribute] <= trigger.above) {
          this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' <= ${trigger.above} for #${configTrigger.entity}#`);
          return false;
        }
        if (from[attribute] > trigger.above) {
          this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' already > ${trigger.above} for #${configTrigger.entity}#`);
          return null;
        }
        this.logger.debug(`[Automations] Trigger check [${automation.name}] trigger above ${trigger.above} is true for #${configTrigger.entity}# ${attribute} is ${to[attribute]} `);
      }

      if (typeof trigger.below !== 'undefined') {
        if (to[attribute] >= trigger.below) {
          this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' >= ${trigger.below} for #${configTrigger.entity}#`);
          return false;
        }
        if (from[attribute] < trigger.below) {
          this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' already < ${trigger.below} for #${configTrigger.entity}#`);
          return null;
        }
        this.logger.debug(`[Automations] Trigger check [${automation.name}] trigger below ${trigger.below} is true for #${configTrigger.entity}# ${attribute} is ${to[attribute]} `);
      }
      return true;
    } else if (configTrigger.state !== undefined) {
      trigger = configTrigger as ConfigStateTrigger;
      attribute = 'state';
      if (!Object.prototype.hasOwnProperty.call(update, attribute) || !Object.prototype.hasOwnProperty.call(to, attribute)) {
        this.logger.debug(`[Automations] Trigger check [${automation.name}] no '${attribute}' published for #${configTrigger.entity}#`);
        return null;
      }
      if (from[attribute] === to[attribute]) {
        this.logger.debug(`[Automations] Trigger check [${automation.name}] no '${attribute}' change for #${configTrigger.entity}#`);
        return null;
      }
      if (to[attribute] !== trigger.state) {
        this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' != ${trigger.state} for #${configTrigger.entity}#`);
        return null;
      }
      this.logger.debug(`[Automations] Trigger check [${automation.name}] trigger state ${trigger.state} is true for #${configTrigger.entity}# state is ${to[attribute]}`);
      return true;
    }
    return false;
  }

  private checkCondition(automation: EventAutomation, condition: ConfigCondition): boolean {
    let timeResult = true;
    let eventResult = true;

    if ((condition as ConfigTimeCondition).after || (condition as ConfigTimeCondition).before || (condition as ConfigTimeCondition).weekday) {
      timeResult = this.checkTimeCondition(automation, condition as ConfigTimeCondition);
    }
    if ((condition as ConfigEntityCondition).entity) {
      eventResult = this.checkEntityCondition(automation, condition as ConfigEntityCondition);
    }
    return (timeResult && eventResult);
  }

  // Return false if condition is false
  private checkTimeCondition(automation: EventAutomation, condition: ConfigTimeCondition): boolean {
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const now = new Date();
    if (condition.weekday && !condition.weekday.includes(days[now.getDay()])) {
      this.logger.debug(`[Automations] Condition check [${automation.name}] time condition is false for weekday: ${this.stringify(condition.weekday)}`);
      return false;
    }
    if (condition.before) {
      const time = this.matchTimeString(condition.before);
      if (time !== undefined) {
        if (now.getTime() > time.getTime()) {
          this.logger.debug(`[Automations] Condition check [${automation.name}] time condition is false for before: ${condition.before}`);
          return false;
        }
      } else {
        this.logger.error(`[Automations] Condition check [${automation.name}] config validation error: before #${condition.before}# ignoring condition`);
      }
    }
    if (condition.after) {
      const time = this.matchTimeString(condition.after);
      if (time !== undefined) {
        if (now.getTime() < time.getTime()) {
          this.logger.debug(`[Automations] Condition check [${automation.name}] time condition is false for after: ${condition.after}`);
          return false;
        }
      } else {
        this.logger.error(`[Automations] Condition check [${automation.name}] config validation error: after #${condition.after}# ignoring condition`);
      }
    }
    this.logger.debug(`[Automations] Condition check [${automation.name}] time condition is true for ${this.stringify(condition)}`);
    return true;
  }

  // Return false if condition is false
  private checkEntityCondition(automation: EventAutomation, condition: ConfigEntityCondition): boolean {
    if (!condition.entity) {
      this.logger.error(`[Automations] Condition check [${automation.name}] config validation error: condition entity not specified`);
      return false;
    }
    const entity = this.zigbee.resolveEntity(condition.entity);
    if (!entity) {
      this.logger.error(`[Automations] Condition check [${automation.name}] config validation error: entity #${condition.entity}# not found`);
      return false;
    }
    const attribute = condition.attribute || 'state';
    const value = this.state.get(entity)[attribute];
    if (condition.state !== undefined && value !== condition.state) {
      this.logger.debug(`[Automations] Condition check [${automation.name}] event condition is false for entity #${condition.entity}# attribute '${attribute}' is '${value}' not '${condition.state}'`);
      return false;
    }
    if (condition.attribute !== undefined && condition.equal !== undefined && value !== condition.equal) {
      this.logger.debug(`[Automations] Condition check [${automation.name}] event condition is false for entity #${condition.entity}# attribute '${attribute}' is '${value}' not equal '${condition.equal}'`);
      return false;
    }
    if (condition.attribute !== undefined && condition.below !== undefined && value >= condition.below) {
      this.logger.debug(`[Automations] Condition check [${automation.name}] event condition is false for entity #${condition.entity}# attribute '${attribute}' is '${value}' not below '${condition.below}'`);
      return false;
    }
    if (condition.attribute !== undefined && condition.above !== undefined && value <= condition.above) {
      this.logger.debug(`[Automations] Condition check [${automation.name}] event condition is false for entity #${condition.entity}# attribute '${attribute}' is '${value}' not above '${condition.above}'`);
      return false;
    }
    this.logger.debug(`[Automations] Condition check [${automation.name}] event condition is true for entity #${condition.entity}# attribute '${attribute}' is '${value}'`);
    return true;
  }

  private runActions(automation: EventAutomation, actions: ConfigAction[]): void {
    for (const action of actions) {
      const entity = this.zigbee.resolveEntity(action.entity);
      if (!entity) {
        this.logger.error(`[Automations] Entity #${action.entity}# not found so ignoring this action`);
        continue;
      }
      let data: ConfigActionPayload;
      //this.log.warn('Payload:', typeof action.payload, action.payload)
      if (typeof action.payload === 'string') {
        if (action.payload === ConfigPayload.TURN_ON) {
          data = { state: ConfigState.ON };
        } else if (action.payload === ConfigPayload.TURN_OFF) {
          data = { state: ConfigState.OFF };
        } else if (action.payload === ConfigPayload.TOGGLE) {
          data = { state: ConfigState.TOGGLE };
        } else {
          this.logger.error(`[Automations] Run automation [${automation.name}] for entity #${action.entity}# error: payload can be turn_on turn_off toggle or an object`);
          return;
        }
      } else if (typeof action.payload === 'object') {
        data = action.payload;
      } else {
        this.logger.error(`[Automations] Run automation [${automation.name}] for entity #${action.entity}# error: payload can be turn_on turn_off toggle or an object`);
        return;
      }
      if (action.logger === 'info')
        this.logger.info(`[Automations] Run automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}#`);
      else if (action.logger === 'warn')
        this.logger.warn(`[Automations] Run automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}#`);
      else if (action.logger === 'error')
        this.logger.error(`[Automations] Run automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}#`);
      else
        this.logger.debug(`[Automations] Run automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}#`);
      this.mqtt.onMessage(`${this.mqttBaseTopic}/${entity.name}/set`, Buffer.from(this.payloadStringify(data)));
      if (action.turn_off_after) {
        this.startActionTurnOffTimeout(automation, action);
      }
    } // End for (const action of actions)
    if (automation.execute_once === true) {
      this.removeAutomation(automation.name);
    }
  }

  private removeAutomation(name: string): void {
    this.log.warning(`Uregistering automation [${name}]`);
    Object.keys(this.eventAutomations).forEach((entity) => {
      this.log.warning(`Entity: #${entity}#`);
      Object.values(this.eventAutomations[entity]).forEach((eventAutomation, index) => {
        if (eventAutomation.name === name) {
          this.log.warning(`Entity: #${entity}# ${index} event automation: ${eventAutomation.name}`);
          this.eventAutomations[entity].splice(index, 1);
        }
        else {
          this.log.info(`Entity: #${entity}# ${index} event automation: ${eventAutomation.name}`);
        }
      });
    });
    Object.keys(this.timeAutomations).forEach((now) => {
      this.log.warning(`Time: #${now}#`);
      Object.values(this.timeAutomations[now]).forEach((timeAutomation, index) => {
        if (timeAutomation.name === name) {
          this.log.warning(`Time: #${now}# ${index} time automation: ${timeAutomation.name}`);
          this.timeAutomations[now].splice(index, 1);
        }
        else {
          this.log.info(`Time: #${now}# ${index} time automation: ${timeAutomation.name}`);
        }
      });
    });
  }

  // Stop the turn_off_after timeout
  private stopActionTurnOffTimeout(automation: EventAutomation, action: ConfigAction): void {
    const timeout = this.turnOffAfterTimeouts[automation.name + action.entity];
    if (timeout) {
      this.logger.debug(`[Automations] Stop turn_off_after timeout for automation [${automation.name}]`);
      clearTimeout(timeout);
      delete this.turnOffAfterTimeouts[automation.name + action.entity];
    }
  }

  // Start the turn_off_after timeout
  private startActionTurnOffTimeout(automation: EventAutomation, action: ConfigAction): void {
    this.stopActionTurnOffTimeout(automation, action);
    this.logger.debug(`[Automations] Start ${action.turn_off_after} seconds turn_off_after timeout for automation [${automation.name}]`);
    const timeout = setTimeout(() => {
      delete this.turnOffAfterTimeouts[automation.name + action.entity];
      //this.logger.debug(`[Automations] Turn_off_after timeout for automation [${automation.name}]`);
      const entity = this.zigbee.resolveEntity(action.entity);
      if (!entity) {
        this.logger.error(`[Automations] Entity #${action.entity}# not found so ignoring this action`);
        this.stopActionTurnOffTimeout(automation, action);
        return;
      }
      const data = { state: ConfigState.OFF };
      if (action.logger === 'info')
        this.logger.info(`[Automations] Turn_off_after timeout for automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}# `);
      else if (action.logger === 'warn')
        this.logger.warn(`[Automations] Turn_off_after timeout for automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}# `);
      else if (action.logger === 'error')
        this.logger.error(`[Automations] Turn_off_after timeout for automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}# `);
      else
        this.logger.debug(`[Automations] Turn_off_after timeout for automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}# `);

      this.mqtt.onMessage(`${this.mqttBaseTopic}/${entity.name}/set`, Buffer.from(this.payloadStringify(data)));
    }, action.turn_off_after! * 1000);
    timeout.unref();
    this.turnOffAfterTimeouts[automation.name + action.entity] = timeout;
  }

  private runActionsWithConditions(automation: EventAutomation, conditions: ConfigCondition[], actions: ConfigAction[]): void {
    for (const condition of conditions) {
      //this.log.warning(`runActionsWithConditions: conditon: ${this.stringify(condition)}`);
      if (!this.checkCondition(automation, condition)) {
        return;
      }
    }
    this.runActions(automation, actions);
  }

  // Stop the trigger_for timeout
  private stopTriggerForTimeout(automation: EventAutomation): void {
    const timeout = this.triggerForTimeouts[automation.name];
    if (timeout) {
      //this.log.debug(`Stop timeout for automation [${automation.name}] trigger: ${this.stringify(automation.trigger)}`);
      this.logger.debug(`[Automations] Stop trigger-for timeout for automation [${automation.name}]`);
      clearTimeout(timeout);
      delete this.triggerForTimeouts[automation.name];
    }
  }

  // Start the trigger_for timeout
  private startTriggerForTimeout(automation: EventAutomation): void {
    if (automation.trigger.for === undefined || automation.trigger.for === 0) {
      this.logger.error(`[Automations] Start ${automation.trigger.for} seconds trigger-for timeout error for automation [${automation.name}]`);
      return;
    }
    this.logger.debug(`[Automations] Start ${automation.trigger.for} seconds trigger-for timeout for automation [${automation.name}]`);
    const timeout = setTimeout(() => {
      delete this.triggerForTimeouts[automation.name];
      this.logger.debug(`[Automations] Trigger-for timeout for automation [${automation.name}]`);
      this.runActionsWithConditions(automation, automation.condition, automation.action);
    }, automation.trigger.for * 1000);
    timeout.unref();
    this.triggerForTimeouts[automation.name] = timeout;
  }

  private runAutomationIfMatches(automation: EventAutomation, update: StateChangeUpdate, from: StateChangeFrom, to: StateChangeTo): void {
    const triggerResult = this.checkTrigger(automation, automation.trigger, update, from, to);
    if (triggerResult === false) {
      this.stopTriggerForTimeout(automation);
      return;
    }
    if (triggerResult === null) {
      return;
    }
    const timeout = this.triggerForTimeouts[automation.name];
    if (timeout) {
      this.logger.debug(`[Automations] Waiting trigger-for timeout for automation [${automation.name}]`);
      return;
    } else {
      this.logger.debug(`[Automations] Start automation [${automation.name}]`);
    }
    if (automation.trigger.for) {
      this.startTriggerForTimeout(automation);
      return;
    }
    this.runActionsWithConditions(automation, automation.condition, automation.action);
  }

  private findAndRun(entityId: EntityId, update: StateChangeUpdate, from: StateChangeFrom, to: StateChangeTo): void {
    const automations = this.eventAutomations[entityId];
    if (!automations) {
      return;
    }
    for (const automation of automations) {
      this.runAutomationIfMatches(automation, update, from, to);
    }
  }

  async start() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.eventBus.onStateChange(this, (data: any) => {
      this.findAndRun(data.entity.name, data.update, data.from, data.to);
    });
  }

  async stop() {
    this.logger.debug(`[Automations] Extension unloading`);
    for (const key of Object.keys(this.triggerForTimeouts)) {
      this.logger.debug(`[Automations] Clearing timeout ${key}`);
      clearTimeout(this.triggerForTimeouts[key]);
      delete this.triggerForTimeouts[key];
    }
    for (const key of Object.keys(this.turnOffAfterTimeouts)) {
      this.logger.debug(`[Automations] Clearing timeout ${key}`);
      clearTimeout(this.turnOffAfterTimeouts[key]);
      delete this.turnOffAfterTimeouts[key];
    }
    clearTimeout(this.midnightTimeout);
    this.logger.debug(`[Automations] Removing listeners`);
    this.eventBus.removeListeners(this);
    this.logger.debug(`[Automations] Extension unloaded`);
  }

  private payloadStringify(payload: object): string {
    return this.stringify(payload, false, 255, 255, 35, 220, 159, 1, '"', '"')
  }

  private stringify(payload: object, enableColors = false, colorPayload = 255, colorKey = 255, colorString = 35, colorNumber = 220, colorBoolean = 159, colorUndefined = 1, keyQuote = '', stringQuote = '\''): string {
    const clr = (color: number) => {
      return enableColors ? `\x1b[38;5;${color}m` : '';
    };
    const reset = () => {
      return enableColors ? `\x1b[0m` : '';
    };
    const isArray = Array.isArray(payload);
    let string = `${reset()}${clr(colorPayload)}` + (isArray ? '[ ' : '{ ');
    Object.entries(payload).forEach(([key, value], index) => {
      if (index > 0) {
        string += ', ';
      }
      let newValue = '';
      newValue = value;
      if (typeof newValue === 'string') {
        newValue = `${clr(colorString)}${stringQuote}${newValue}${stringQuote}${reset()}`;
      }
      if (typeof newValue === 'number') {
        newValue = `${clr(colorNumber)}${newValue}${reset()}`;
      }
      if (typeof newValue === 'boolean') {
        newValue = `${clr(colorBoolean)}${newValue}${reset()}`;
      }
      if (typeof newValue === 'undefined') {
        newValue = `${clr(colorUndefined)}undefined${reset()}`;
      }
      if (typeof newValue === 'object') {
        newValue = this.stringify(newValue, enableColors, colorPayload, colorKey, colorString, colorNumber, colorBoolean, colorUndefined, keyQuote, stringQuote);
      }
      // new
      if (isArray)
        string += `${newValue}`;
      else
        string += `${clr(colorKey)}${keyQuote}${key}${keyQuote}${reset()}: ${newValue}`;
    });
    return string += ` ${clr(colorPayload)}` + (isArray ? ']' : '}') + `${reset()}`;
  }
}

/*
FROM HERE IS THE COPY IN TS OF SUNCALC PACKAGE https://www.npmjs.com/package/suncalc
*/

//
// Use https://www.latlong.net/ to get latidute and longitude based on your adress
//

// sun calculations are based on http://aa.quae.nl/en/reken/zonpositie.html formulas

// shortcuts for easier to read formulas
const PI = Math.PI,
  sin = Math.sin,
  cos = Math.cos,
  tan = Math.tan,
  asin = Math.asin,
  atan = Math.atan2,
  acos = Math.acos,
  rad = PI / 180;

// date/time constants and conversions
const dayMs = 1000 * 60 * 60 * 24,
  J1970 = 2440588,
  J2000 = 2451545;
function toJulian(date) { return date.valueOf() / dayMs - 0.5 + J1970; }
function fromJulian(j) { return new Date((j + 0.5 - J1970) * dayMs); }
function toDays(date) { return toJulian(date) - J2000; }

// general calculations for position
const e = rad * 23.4397; // obliquity of the Earth
function rightAscension(l, b) { return atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l)); }
function declination(l, b) { return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l)); }
function azimuth(H, phi, dec) { return atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi)); }
function altitude(H, phi, dec) { return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H)); }
function siderealTime(d, lw) { return rad * (280.16 + 360.9856235 * d) - lw; }
function astroRefraction(h) {
  if (h < 0) // the following formula works for positive altitudes only.
    h = 0; // if h = -0.08901179 a div/0 would occur.
  // formula 16.4 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.
  // 1.02 / tan(h + 10.26 / (h + 5.10)) h in degrees, result in arc minutes -> converted to rad:
  return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
}

// general sun calculations
function solarMeanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }
function eclipticLongitude(M) {
  const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)), // equation of center
    P = rad * 102.9372; // perihelion of the Earth
  return M + C + P + PI;
}

function sunCoords(d) {
  const M = solarMeanAnomaly(d),
    L = eclipticLongitude(M);
  return {
    dec: declination(L, 0),
    ra: rightAscension(L, 0)
  };
}

// calculations for sun times
const J0 = 0.0009;
function julianCycle(d, lw) { return Math.round(d - J0 - lw / (2 * PI)); }
function approxTransit(Ht, lw, n) { return J0 + (Ht + lw) / (2 * PI) + n; }
function solarTransitJ(ds, M, L) { return J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L); }
function hourAngle(h, phi, d) { return acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d))); }
function observerAngle(height) { return -2.076 * Math.sqrt(height) / 60; }
// returns set time for the given sun altitude
function getSetJ(h, lw, phi, dec, n, M, L) {
  const w = hourAngle(h, phi, dec),
    a = approxTransit(w, lw, n);
  return solarTransitJ(a, M, L);
}

// moon calculations, based on http://aa.quae.nl/en/reken/hemelpositie.html formulas
function moonCoords(d) { // geocentric ecliptic coordinates of the moon
  const L = rad * (218.316 + 13.176396 * d), // ecliptic longitude
    M = rad * (134.963 + 13.064993 * d), // mean anomaly
    F = rad * (93.272 + 13.229350 * d),  // mean distance

    l = L + rad * 6.289 * sin(M), // longitude
    b = rad * 5.128 * sin(F),     // latitude
    dt = 385001 - 20905 * cos(M);  // distance to the moon in km

  return {
    ra: rightAscension(l, b),
    dec: declination(l, b),
    dist: dt
  };
}

function hoursLater(date, h) {
  return new Date(date.valueOf() + h * dayMs / 24);
}

class SunCalc {
  // calculates sun position for a given date and latitude/longitude
  // @ts-ignore: Unused method
  private getPosition(date, lat, lng) {

    const lw = rad * -lng,
      phi = rad * lat,
      d = toDays(date),

      c = sunCoords(d),
      H = siderealTime(d, lw) - c.ra;

    return {
      azimuth: azimuth(H, phi, c.dec),
      altitude: altitude(H, phi, c.dec)
    };
  }

  // sun times configuration (angle, morning name, evening name)
  private times = [
    [-0.833, 'sunrise', 'sunset'],
    [-0.3, 'sunriseEnd', 'sunsetStart'],
    [-6, 'dawn', 'dusk'],
    [-12, 'nauticalDawn', 'nauticalDusk'],
    [-18, 'nightEnd', 'night'],
    [6, 'goldenHourEnd', 'goldenHour']
  ];

  // adds a custom time to the times config
  // @ts-ignore: Unused method
  private addTime(angle, riseName, setName) {
    this.times.push([angle, riseName, setName]);
  }

  // calculates sun times for a given date, latitude/longitude, and, optionally,
  // the observer height (in meters) relative to the horizon
  public getTimes(date, lat, lng, height) {
    height = height || 0;

    const lw = rad * -lng,
      phi = rad * lat,
      dh = observerAngle(height),
      d = toDays(date),
      n = julianCycle(d, lw),
      ds = approxTransit(0, lw, n),
      M = solarMeanAnomaly(ds),
      L = eclipticLongitude(M),
      dec = declination(L, 0),
      Jnoon = solarTransitJ(ds, M, L);
    let i, len, time, h0, Jset, Jrise;
    const result = {
      solarNoon: fromJulian(Jnoon),
      nadir: fromJulian(Jnoon - 0.5)
    };

    for (i = 0, len = this.times.length; i < len; i += 1) {
      time = this.times[i];
      h0 = (time[0] + dh) * rad;
      Jset = getSetJ(h0, lw, phi, dec, n, M, L);
      Jrise = Jnoon - (Jset - Jnoon);
      result[time[1]] = fromJulian(Jrise);
      result[time[2]] = fromJulian(Jset);
    }

    return result;
  }

  private getMoonPosition(date, lat, lng) {
    const lw = rad * -lng,
      phi = rad * lat,
      d = toDays(date),
      c = moonCoords(d),
      H = siderealTime(d, lw) - c.ra;
    let h = altitude(H, phi, c.dec);
    // formula 14.1 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.
    const pa = atan(sin(H), tan(phi) * cos(c.dec) - sin(c.dec) * cos(H));
    h = h + astroRefraction(h); // altitude correction for refraction

    return {
      azimuth: azimuth(H, phi, c.dec),
      altitude: h,
      distance: c.dist,
      parallacticAngle: pa
    };
  }

  // calculations for illumination parameters of the moon,
  // based on http://idlastro.gsfc.nasa.gov/ftp/pro/astro/mphase.pro formulas and
  // Chapter 48 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.
  // @ts-ignore: Unused method
  private getMoonIllumination(date) {
    const d = toDays(date || new Date()),
      s = sunCoords(d),
      m = moonCoords(d),
      sdist = 149598000, // distance from Earth to Sun in km
      phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra)),
      inc = atan(sdist * sin(phi), m.dist - sdist * cos(phi)),
      angle = atan(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) -
        cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));

    return {
      fraction: (1 + cos(inc)) / 2,
      phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI,
      angle: angle
    };
  }

  // calculations for moon rise/set times are based on http://www.stargazing.net/kepler/moonrise.html article
  // @ts-ignore: Unused method
  private getMoonTimes(date, lat, lng, inUTC) {
    const t = new Date(date);
    if (inUTC) t.setUTCHours(0, 0, 0, 0);
    else t.setHours(0, 0, 0, 0);
    const hc = 0.133 * rad;
    let h0 = this.getMoonPosition(t, lat, lng).altitude - hc;
    let h1, h2, rise, set, a, b, xe, ye, d, roots, x1, x2, dx;
    // go in 2-hour chunks, each time seeing if a 3-point quadratic curve crosses zero (which means rise or set)
    for (let i = 1; i <= 24; i += 2) {
      h1 = this.getMoonPosition(hoursLater(t, i), lat, lng).altitude - hc;
      h2 = this.getMoonPosition(hoursLater(t, i + 1), lat, lng).altitude - hc;
      a = (h0 + h2) / 2 - h1;
      b = (h2 - h0) / 2;
      xe = -b / (2 * a);
      ye = (a * xe + b) * xe + h1;
      d = b * b - 4 * a * h1;
      roots = 0;

      if (d >= 0) {
        dx = Math.sqrt(d) / (Math.abs(a) * 2);
        x1 = xe - dx;
        x2 = xe + dx;
        if (Math.abs(x1) <= 1) roots++;
        if (Math.abs(x2) <= 1) roots++;
        if (x1 < -1) x1 = x2;
      }

      if (roots === 1) {
        if (h0 < 0) rise = i + x1;
        else set = i + x1;

      } else if (roots === 2) {
        rise = i + (ye < 0 ? x2 : x1);
        set = i + (ye < 0 ? x1 : x2);
      }

      if (rise && set) break;

      h0 = h2;
    }

    const result = {};

    if (rise) result[rise] = hoursLater(t, rise);
    if (set) result[set] = hoursLater(t, set);

    if (!rise && !set) result[ye > 0 ? 'alwaysUp' : 'alwaysDown'] = true;

    return result;
  }

}

export = AutomationsExtension;
