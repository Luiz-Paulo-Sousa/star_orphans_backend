/** Cria o banco de dados se não existir */
CREATE DATABASE IF NOT EXISTS _orphans_api DEFAULT CHARACTER SET utf8;
USE _orphans_api;


/** Relação dos tipos de itens */
CREATE TABLE IF NOT EXISTS `item_types` (
	`type`  INT     UNSIGNED NOT NULL AUTO_INCREMENT,
	`name` CHAR(20)          NOT NULL,
	
	PRIMARY KEY (`type`)
)
COMMENT = 'Relação dos tipos de itens'
COLLATE = 'utf8_general_ci'
ENGINE  =  InnoDB;

INSERT IGNORE INTO `item_types`
VALUES
	(0, 'Item'),
	(1, 'Device'),
	(2, 'Missile'),
	(3, 'Utility'),
	(4, 'Vessel'),
	(5, 'Weapon');


/** Relação da classificação dos itens */
CREATE TABLE IF NOT EXISTS `item_tiers` (
	`tier`  INT     UNSIGNED NOT NULL AUTO_INCREMENT,
	`name` CHAR(20)          NOT NULL,
	
	PRIMARY KEY (`tier`)
)
COMMENT = 'Relação da classificação dos itens'
COLLATE = 'utf8_general_ci'
ENGINE  =  InnoDB;

INSERT IGNORE INTO `item_tiers`
VALUES
	(1, 'Tier I'),
	(2, 'Tier II'),
	(3, 'Tier III'),
	(4, 'Tier S');


/** Relação de itens presentes no jogo */
CREATE TABLE IF NOT EXISTS `items` (
	`item_code`        INT     UNSIGNED NOT NULL,
	
	`name`            CHAR(30)          NOT NULL,
	`about`           TEXT              NOT NULL,
	`type`             INT     UNSIGNED NOT NULL,
	`tier`             INT     UNSIGNED NOT NULL,
	
	`device_slots`     INT              NOT NULL DEFAULT '0',
	`missile_slots`    INT              NOT NULL DEFAULT '0',
	`utility_slots`    INT              NOT NULL DEFAULT '0',
	`weapon_slots`     INT              NOT NULL DEFAULT '0',
	
	`ensilage`         INT              NOT NULL DEFAULT '0',
	`magaxine`         INT              NOT NULL DEFAULT '0',
	`stacking`         INT              NOT NULL DEFAULT '0',
	
	`effect_area`    FLOAT              NOT NULL DEFAULT '0.0',
	
	`recharge_time`  FLOAT              NOT NULL DEFAULT '0.0',
	`effect_time`    FLOAT              NOT NULL DEFAULT '0.0',
	`life_time`      FLOAT              NOT NULL DEFAULT '0.0',
	
	`energy_require` FLOAT              NOT NULL DEFAULT '0.0',
	`energy_restore` FLOAT              NOT NULL DEFAULT '0.0',
	`shield_restore` FLOAT              NOT NULL DEFAULT '0.0',
	
	`energy_damage`  FLOAT              NOT NULL DEFAULT '0.0',
	`shield_damege`  FLOAT              NOT NULL DEFAULT '0.0',
	`armor_damage`   FLOAT              NOT NULL DEFAULT '0.0',
	
	`energy`         FLOAT              NOT NULL DEFAULT '0.0',
	`shield`         FLOAT              NOT NULL DEFAULT '0.0',
	`armor`          FLOAT              NOT NULL DEFAULT '0.0',
	
	`ftl_range`      FLOAT              NOT NULL DEFAULT '0.0',
	
	`steering`       FLOAT              NOT NULL DEFAULT '0.0',
	`cruise`         FLOAT              NOT NULL DEFAULT '0.0',
	`burner`         FLOAT              NOT NULL DEFAULT '0.0',
	`speed`          FLOAT              NOT NULL DEFAULT '0.0',
	
	`factor`         FLOAT              NOT NULL DEFAULT '0.0',
	
	`range`          FLOAT              NOT NULL DEFAULT '0.0',
	
	`volume`           INT              NOT NULL,
	`price`            INT              NOT NULL,
	
	`prefab`          CHAR(200)             NULL,
	`icon`            CHAR(200)         NOT NULL,
	
	PRIMARY KEY (`item_code`),
	
	INDEX `ITEM_TYPE` (`type`),
	INDEX `ITEM_TIER` (`tier`),
	
	CONSTRAINT `FK_ITEM_TYPE_ON_ITEMS` FOREIGN KEY (`type`) REFERENCES `item_types` (`type`),
	CONSTRAINT `FK_ITEM_TIER_ON_ITEMS` FOREIGN KEY (`tier`) REFERENCES `item_tiers` (`tier`)
)
COMMENT = 'Relação de itens presentes no jogo'
COLLATE = 'utf8_general_ci'
ENGINE  =  InnoDB;