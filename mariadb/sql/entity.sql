/** Cria o banco de dados se não existir */
CREATE DATABASE IF NOT EXISTS _orphans_api DEFAULT CHARACTER SET utf8;
USE _orphans_api;


/** Registros de pilotos */
CREATE TABLE IF NOT EXISTS `pilots` (
	`pilot_uid`     INT          UNSIGNED NOT NULL,
	
	`name`         CHAR(30)               NOT NULL,
	
	`node`         CHAR(30)               NOT NULL DEFAULT 'Maldek',
	`station`      CHAR(30)               NOT NULL DEFAULT 'Habitat',
	
	`region`       CHAR(60)               NOT NULL DEFAULT 'South America',
	
	`docked`       ENUM('y','n')          NOT NULL DEFAULT 'y',
	`dead`         ENUM('y','n')          NOT NULL DEFAULT 'n',
	
	PRIMARY KEY (`pilot_uid`)
)
COMMENT = 'Registros de pilotos'
COLLATE = 'utf8_general_ci'
ENGINE  =  InnoDB;


/** Registros de rankings */
CREATE TABLE IF NOT EXISTS `rankings` (
	`ranking_uid`   INT          UNSIGNED NOT NULL,
	
	`kills`         INT                   NOT NULL DEFAULT '0',
	`deaths`        INT                   NOT NULL DEFAULT '0',
	`assists`       INT                   NOT NULL DEFAULT '0',
	
	`arcan_rp`      INT                   NOT NULL DEFAULT '0',
	`dissident_rp`  INT                   NOT NULL DEFAULT '0',
	
	`miner_rp`      INT                   NOT NULL DEFAULT '0',
	`explorer_rp`   INT                   NOT NULL DEFAULT '0',
	`engineer_rp`   INT                   NOT NULL DEFAULT '0',
	`merchant_rp`   INT                   NOT NULL DEFAULT '0',
	
	PRIMARY KEY (`pilot_uid`)
)
COMMENT = 'Registros de rankings'
COLLATE = 'utf8_general_ci'
ENGINE  =  InnoDB;


/** Registros de carteiras */
CREATE TABLE IF NOT EXISTS `wallets` (
	`wallet_uid`  INT     UNSIGNED NOT NULL,
	`name`       CHAR(30)          NOT NULL,
	
	`cash`        INT              NOT NULL DEFAULT '0',
	`credits`     INT              NOT NULL DEFAULT '1000000',
	
	UNIQUE INDEX `WALLET_UID` (`wallet_uid`)
)
COMMENT = 'Registros de carteiras'
COLLATE = 'utf8_general_ci'
ENGINE  =  InnoDB;