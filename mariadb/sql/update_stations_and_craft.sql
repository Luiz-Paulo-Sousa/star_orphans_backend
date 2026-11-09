-- ==============================================================================
-- ATUALIZAÇÃO DA TABELA ORBIT_STATIONS (TIPO FÁBRICA POR PADRÃO) E CRAFT
-- Banco de Dados: _starorphans
-- ==============================================================================

USE `_starorphans`;

-- 1. Adiciona a facção controladora e o tipo da estação (padrão 'fabrica')
ALTER TABLE `orbit_stations`
    ADD COLUMN IF NOT EXISTS `faction_uid` INT UNSIGNED NULL 
        COMMENT 'Facção controladora (factions.faction_uid)',
    ADD COLUMN IF NOT EXISTS `station_type` ENUM('civil', 'militar', 'refinaria', 'fundicao', 'fabrica') NOT NULL DEFAULT 'fabrica' 
        COMMENT 'Tipo da estação: civil, militar, refinaria, fundicao ou fabrica';

-- 2. Define todas as estações existentes como 'fabrica'
UPDATE `orbit_stations` 
SET `station_type` = 'fabrica' 
WHERE `station_type` IS NULL OR `station_type` = 'civil';

-- 3. Índices para performance
CREATE INDEX IF NOT EXISTS `idx_station_faction` ON `orbit_stations` (`faction_uid`);
CREATE INDEX IF NOT EXISTS `idx_station_type` ON `orbit_stations` (`station_type`);

-- 4. Cadastra/sincroniza as estações na tabela accounts para servirem de remetente no chat
-- Cada estação ganha uma conta com uid = (100000 + id da estação)
INSERT IGNORE INTO `accounts` (`uid`, `account`, `email`, `email_verified`)
SELECT 
    (100000 + id) AS `uid`,
    `name` AS `account`,
    CONCAT('station_', id, '@starorphans.system') AS `email`,
    1 AS `email_verified`
FROM `orbit_stations`;
